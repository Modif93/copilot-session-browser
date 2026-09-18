import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { decodeMulti } from '@msgpack/msgpack';
import { extractCodeBlocks, parseDate } from './parserService';
import { Message, SessionWithMessages, DiscoveryResult } from '../models/types';
import type { ExternalCollection } from './externalSessionService';

export interface VisualStudioPaths { roots: string[]; logDirectories: string[] }
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown): string => typeof v === 'string' ? v : '';
const detail = (e: unknown): string => e instanceof Error ? e.message : String(e);

export function defaultVisualStudioPaths(platform = process.platform, home = os.homedir(), env = process.env): VisualStudioPaths {
  if (platform !== 'win32') { return { roots: [], logDirectories: [] }; }
  const join = path.win32.join;
  const local = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
  return {
    roots: [join(home, 'source', 'repos'), join(home, 'Documents', 'Visual Studio 2022', 'Projects'), join(home, 'Documents', 'Visual Studio 2026', 'Projects')],
    logDirectories: [...new Set([join(env.TEMP || join(local, 'Temp'), 'VSGitHubCopilotLogs'), join(local, 'Temp', 'VSGitHubCopilotLogs')])],
  };
}

/** Observed on-disk format; not a Microsoft-published compatibility contract.
 * Source: rajbos/ai-engineering-fluency, src/visualstudio.ts.
 * Version byte 1, header map, then alternating request/response tagged tuples.
 */
export function parseVisualStudioSession(bytes: Uint8Array, filePath: string, fallback: Date): { session?: SessionWithMessages; errors: string[] } {
  const errors: string[] = [];
  if (bytes.length < 2 || bytes[0] !== 1) { return { errors: ['Unsupported Visual Studio session version (expected 1)'] }; }
  const objects: unknown[] = [];
  try { for (const item of decodeMulti(bytes.subarray(1))) { objects.push(item); } }
  catch (e) { errors.push(`Incomplete or invalid MessagePack stream: ${detail(e)}`); }
  const header = record(objects[0]);
  if (!('TimeCreated' in header) && !('TimeUpdated' in header)) {
    return { errors: [...errors, 'Unrecognized Visual Studio session header'] };
  }
  const normalized = filePath.replace(/\\/g, '/');
  const canonical = /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
  const id = `visual-studio:${createHash('sha256').update(canonical).digest('hex')}`;
  const messages: Message[] = [];
  for (let i = 1; i < objects.length; i++) {
    const tuple = objects[i];
    if (!Array.isArray(tuple) || tuple.length !== 2) {
      errors.push(`Unsupported message structure at record ${i}`); continue;
    }
    const body = record(tuple[1]);
    if (!Array.isArray(body.Content)) { errors.push(`Missing Content at record ${i}`); continue; }
    const content = body.Content.map(part => Array.isArray(part) ? text(record(part[1]).Content) : '').filter(Boolean).join('\n');
    if (!content) { continue; }
    messages.push({ id: `${id}:${i}`, sessionId: id, role: i % 2 ? 'user' : 'assistant',
      markdownContent: content, codeBlocks: extractCodeBlocks(content) });
  }
  const marker = normalized.toLowerCase().lastIndexOf('/.vs/');
  return { session: {
    id, title: text(header.Name) || messages.find(m => m.role === 'user')?.markdownContent.slice(0, 100) || 'Untitled session',
    createdAt: parseDate(header.TimeCreated) || fallback, updatedAt: parseDate(header.TimeUpdated) || fallback,
    workspaceContext: marker >= 0 ? normalized.slice(0, marker) : undefined,
    tags: ['visual-studio'], schemaVersion: 'visual-studio-msgpack-v1', filePath,
    messageCount: messages.length, messages,
  }, errors };
}

const ignored = new Set(['node_modules', '.git', 'bin', 'obj', 'out', 'dist', 'build', 'packages', 'vendor', '.venv', 'target']);
const sessionPath = /\/\.vs\/[^/]+\/copilot-chat\/[^/]+\/sessions\/[^/]+$/i;
const MAX_FILE_BYTES = 64 * 1024 * 1024;

export async function collectVisualStudioSessions(paths: VisualStudioPaths): Promise<ExternalCollection> {
  const result: ExternalCollection = { sessions: [], searchPaths: [], discoveredFiles: [], errors: [] };
  const candidates = new Set<string>();
  const visited = new Map<string, number>();
  const scannedLogSessionDirs = new Set<string>();
  let directoriesLeft = 10000;
  const normalizeKey = (p: string): string => process.platform === 'win32' ? p.toLowerCase() : p;
  async function entries(dir: string): Promise<import('fs').Dirent[]> {
    try { return await fs.readdir(dir, { withFileTypes: true }); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') { result.errors.push(`${dir}: ${detail(e)}`); }
      return [];
    }
  }
  async function add(file: string): Promise<void> {
    if (!sessionPath.test(file.replace(/\\/g, '/'))) { return; }
    try { candidates.add(await fs.realpath(file)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') { result.errors.push(`${file}: ${detail(e)}`); } }
  }
  async function scanVs(vs: string): Promise<void> {
    for (const solution of await entries(vs)) {
      if (!solution.isDirectory()) { continue; }
      const chats = path.join(vs, solution.name, 'copilot-chat');
      for (const hash of await entries(chats)) {
        if (!hash.isDirectory()) { continue; }
        const sessions = path.join(chats, hash.name, 'sessions');
        for (const file of await entries(sessions)) { if (file.isFile()) { await add(path.join(sessions, file.name)); } }
      }
    }
  }
  async function scan(dir: string, depth: number): Promise<void> {
    const key = normalizeKey(path.resolve(dir));
    if ((visited.get(key) ?? Infinity) <= depth) { return; }
    visited.set(key, depth);
    if (--directoriesLeft < 0) { return; }
    if (path.basename(dir).toLowerCase() === '.vs') { await scanVs(dir); return; }
    // Check .vs even at the recursion boundary.
    for (const entry of await entries(dir)) {
      if (!entry.isDirectory()) { continue; }
      const child = path.join(dir, entry.name);
      if (entry.name.toLowerCase() === '.vs') { await scan(child, depth); }
      else if (depth < 5 && !entry.name.startsWith('.') && !ignored.has(entry.name.toLowerCase())) { await scan(child, depth + 1); }
    }
  }
  for (const dir of [...new Set([...paths.roots, ...paths.logDirectories])]) {
    try { result.searchPaths.push({ path: dir, exists: (await fs.stat(dir)).isDirectory() }); }
    catch { result.searchPaths.push({ path: dir, exists: false }); }
  }
  for (const dir of paths.logDirectories) {
    for (const entry of await entries(dir)) {
      if (!entry.isFile() || !entry.name.endsWith('.chat.log')) { continue; }
      const file = path.join(dir, entry.name);
      try {
        if ((await fs.stat(file)).size > MAX_FILE_BYTES) { throw new Error('Log exceeds 64 MiB read limit'); }
        const log = await fs.readFile(file, 'utf8');
        for (const match of log.matchAll(/Updating session file '([^\r\n]+)'/g)) {
          if (path.isAbsolute(match[1])) {
            await add(match[1]);
            // Include sibling sessions even if they have no entry in the current logs.
            const sessionDir = path.dirname(match[1]);
            if (sessionPath.test(match[1].replace(/\\/g, '/')) && !scannedLogSessionDirs.has(normalizeKey(sessionDir))) {
              scannedLogSessionDirs.add(normalizeKey(sessionDir));
              for (const sibling of await entries(sessionDir)) {
                if (sibling.isFile()) { await add(path.join(path.dirname(match[1]), sibling.name)); }
              }
            }
          }
        }
      } catch (e) { result.errors.push(`${file}: ${detail(e)}`); }
    }
  }
  for (const root of paths.roots) {
    if (!path.isAbsolute(root)) { result.errors.push(`Visual Studio search path must be absolute: ${root}`); continue; }
    await scan(root, 0);
  }
  if (directoriesLeft < 0) { result.errors.push('Visual Studio scan reached 10000 directories. Configure more specific visualStudioSearchPaths.'); }
  for (const file of candidates) {
    const entry: DiscoveryResult = { path: file, type: 'msgpack', schemaVersion: 'visual-studio-msgpack-v1', sessionCount: 0, errors: [] };
    result.discoveredFiles.push(entry);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) { throw new Error('Not a regular session file or exceeds 64 MiB read limit'); }
      const parsed = parseVisualStudioSession(await fs.readFile(file), file, stat.mtime);
      entry.errors.push(...parsed.errors);
      if (parsed.session?.messageCount) { result.sessions.push(parsed.session); entry.sessionCount = 1; }
    } catch (e) { entry.errors.push(detail(e)); }
    result.errors.push(...entry.errors.map(e => `${file}: ${e}`));
  }
  return result;
}
