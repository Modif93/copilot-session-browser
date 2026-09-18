import { collectVisualStudioSessions, VisualStudioPaths, defaultVisualStudioPaths } from './visualStudioSessionService';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { decompress } from 'fzstd';
import { parse as parseYaml } from 'yaml';
import { DiscoveryResult, SearchPath, SessionWithMessages, Message } from '../models/types';
import { extractCodeBlocks, parseDate } from './parserService';
import { loadSqlJs } from './sqliteReaderService';

const object = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const string = (v: unknown): string => typeof v === 'string' ? v : '';
const array = (v: unknown): any[] => Array.isArray(v) ? v : [];
const errorText = (e: unknown): string => e instanceof Error ? e.message : String(e);

export interface ExternalPaths { zedDatabase: string; jetbrainsSessionRoot: string }
export interface ExternalCollection {
  sessions: SessionWithMessages[];
  discoveredFiles: DiscoveryResult[];
  searchPaths: SearchPath[];
  errors: string[];
}

export function defaultExternalPaths(platform = process.platform, home = os.homedir(), env = process.env): ExternalPaths {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const zedRoot = platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Zed')
    : platform === 'win32' ? join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Zed')
    : join(env.FLATPAK_XDG_DATA_HOME || env.XDG_DATA_HOME || join(home, '.local', 'share'), 'zed');
  return { zedDatabase: join(zedRoot, 'threads', 'threads.db'), jetbrainsSessionRoot: join(home, '.copilot', 'session-state') };
}

function message(sessionId: string, id: string, role: Message['role'], content: string, timestamp?: unknown): Message {
  return { sessionId, id, role, markdownContent: content, timestamp: parseDate(timestamp), codeBlocks: extractCodeBlocks(content) };
}

function session(source: string, rawId: string, filePath: string, title: unknown, workspace: unknown,
  created: unknown, updated: unknown, messages: Message[], fallback: Date): SessionWithMessages {
  return {
    id: `${source}:${rawId}`, title: string(title) || messages.find(m => m.role === 'user')?.markdownContent.slice(0, 100) || 'Untitled session',
    workspaceContext: string(workspace) || undefined, createdAt: parseDate(created) || fallback,
    updatedAt: parseDate(updated) || fallback, tags: [source], filePath, schemaVersion: source,
    messageCount: messages.length, messages,
  };
}

// Zed's current Rust enum serialization and its earlier role/segments format.
export function parseZedThread(row: Record<string, any>, filePath: string, fallback: Date): SessionWithMessages {
  if (!string(row.id)) { throw new Error('Zed thread has no id'); }
  if (row.data_type !== 'json' && row.data_type !== 'zstd') { throw new Error(`Unsupported Zed data_type: ${row.data_type}`); }
  const bytes = typeof row.data === 'string' ? Buffer.from(row.data) : row.data;
  const raw = object(JSON.parse(Buffer.from(row.data_type === 'zstd' ? decompress(bytes) : bytes).toString('utf8')));
  if (!Array.isArray(raw.messages)) { throw new Error('Zed thread has no messages array'); }
  const id = `zed:${row.id}`;
  const messages: Message[] = [];
  for (const [i, value] of raw.messages.entries()) {
    const entry = object(value);
    let role: Message['role'];
    let content = '';
    if (entry.User || entry.Agent) {
      role = entry.User ? 'user' : 'assistant';
      const body = object(entry.User || entry.Agent);
      content = array(body.content).map(part => {
        const p = object(part);
        return string(p.Text) || string(object(p.Mention).content) || (p.Image ? '[Image attachment]' : '');
      }).filter(Boolean).join('\n\n');
    } else if (['user', 'assistant', 'system'].includes(entry.role)) {
      role = entry.role;
      content = string(entry.content) || array(entry.segments).filter(p => p.type === 'text').map(p => string(p.text)).join('\n\n');
    } else if (entry.Compaction?.Summary) {
      role = 'system'; content = string(entry.Compaction.Summary);
    } else { continue; }
    if (content) { messages.push(message(id, `${id}:${i}`, role, content, entry.timestamp)); }
  }
  const folders = string(row.folder_paths).split('\n').filter(Boolean);
  const order = string(row.folder_paths_order).split(',').map(Number);
  const primary = folders[order.indexOf(0)] || folders[0];
  return session('zed', row.id, filePath, row.summary || raw.title || raw.summary, primary,
    row.created_at, row.updated_at || raw.updated_at, messages, fallback);
}

export function parseJetbrainsSession(text: string, metadata: unknown, rawId: string, filePath: string, fallback: Date): { session?: SessionWithMessages; errors: string[] } {
  const meta = object(metadata);
  if (meta.client_name !== 'copilot-intellij') { return { errors: [] }; }
  const errors: string[] = [];
  const events: Record<string, any>[] = [];
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) { continue; }
    try { events.push(object(JSON.parse(line))); }
    catch { errors.push(`Invalid event JSON at line ${i + 1}`); }
  }
  const start = events.find(e => e.type === 'session.start');
  const context = object(object(start?.data).context);
  const id = `jetbrains-copilot:${rawId}`;
  const messages: Message[] = [];
  const seen = new Set<string>();
  for (const [i, event] of events.entries()) {
    if (event.ephemeral || (event.type !== 'user.message' && event.type !== 'assistant.message')) { continue; }
    const data = object(event.data);
    const content = string(data.content);
    const eventId = string(event.id) || String(i);
    if (!content || seen.has(eventId)) { continue; }
    seen.add(eventId);
    messages.push(message(id, `${id}:${eventId}`, event.type === 'user.message' ? 'user' : 'assistant', content, event.timestamp));
  }
  const times = events.map(e => parseDate(e.timestamp)).filter((d): d is Date => !!d).sort((a,b) => +a - +b);
  return { session: session('jetbrains-copilot', rawId, filePath, meta.summary || meta.title,
    meta.cwd || context.cwd, meta.created_at || times[0], meta.updated_at || times.at(-1), messages, fallback), errors };
}

/** Reads sources only. SQL.js opens an in-memory copy, never the user's database. */
export class ExternalSessionService {
  constructor(private readonly extensionPath: string, private readonly paths = defaultExternalPaths(), private readonly visualStudioPaths: VisualStudioPaths = defaultVisualStudioPaths()) {}

  async collect(): Promise<ExternalCollection> {
    const result: ExternalCollection = { sessions: [], discoveredFiles: [], errors: [], searchPaths: [] };
    for (const sourcePath of [this.paths.zedDatabase, this.paths.jetbrainsSessionRoot]) {
      result.searchPaths.push({ path: sourcePath, exists: fs.existsSync(sourcePath) });
    }
    if (fs.existsSync(this.paths.zedDatabase)) {
      const entry: DiscoveryResult = { path: this.paths.zedDatabase, type: 'sqlite', schemaVersion: 'zed', sessionCount: 0, errors: [] };
      result.discoveredFiles.push(entry);
      try {
        const SQL = await loadSqlJs(this.extensionPath);
        const data = fs.readFileSync(entry.path);
        // Never silently present a stale database while uncheckpointed writes exist.
        const wal = `${entry.path}-wal`;
        if (fs.existsSync(wal) && fs.statSync(wal).size > 32) {
          entry.errors.push('Zed has pending WAL data. Close Zed and refresh to include the latest sessions.');
        }
        data[18] = 1; data[19] = 1; // In-memory read uses rollback mode; source remains unchanged.
        const db = new SQL.Database(data);
        try {
          const rows = db.exec('SELECT * FROM threads');
          entry.tableNames = ['threads'];
          for (const values of rows[0]?.values || []) {
            const row = Object.fromEntries(rows[0].columns.map((name: string, i: number) => [name, values[i]]));
            try {
              const parsed = parseZedThread(row, entry.path, fs.statSync(entry.path).mtime);
              if (parsed.messageCount) { result.sessions.push(parsed); entry.sessionCount++; }
            } catch (e) { entry.errors.push(`Thread ${row.id}: ${errorText(e)}`); }
          }
        } finally { db.close(); }
      } catch (e) { entry.errors.push(errorText(e)); }
    }
    if (fs.existsSync(this.paths.jetbrainsSessionRoot)) {
      try {
        for (const dir of fs.readdirSync(this.paths.jetbrainsSessionRoot, { withFileTypes: true })) {
          if (!dir.isDirectory()) { continue; }
          const folder = path.join(this.paths.jetbrainsSessionRoot, dir.name);
          const entry: DiscoveryResult = { path: path.join(folder, 'events.jsonl'), type: 'jsonl', schemaVersion: 'jetbrains-copilot', sessionCount: 0, errors: [] };
          try {
            const meta = parseYaml(fs.readFileSync(path.join(folder, 'workspace.yaml'), 'utf8'));
            if (object(meta).client_name !== 'copilot-intellij') { continue; }
            result.discoveredFiles.push(entry);
            const parsed = parseJetbrainsSession(fs.readFileSync(entry.path, 'utf8'), meta, dir.name, entry.path, fs.statSync(entry.path).mtime);
            entry.errors.push(...parsed.errors);
            if (parsed.session?.messageCount) { result.sessions.push(parsed.session); entry.sessionCount = 1; }
          } catch (e) {
            if (!result.discoveredFiles.includes(entry)) { result.discoveredFiles.push(entry); }
            entry.errors.push(errorText(e));
          }
        }
      } catch (e) { result.errors.push(`${this.paths.jetbrainsSessionRoot}: ${errorText(e)}`); }
    }
    result.errors.push(...result.discoveredFiles.flatMap(f => f.errors.map(e => `${f.path}: ${e}`)));
    const visualStudio = await collectVisualStudioSessions(this.visualStudioPaths);
    result.sessions.push(...visualStudio.sessions);
    result.searchPaths.push(...visualStudio.searchPaths);
    result.discoveredFiles.push(...visualStudio.discoveredFiles);
    result.errors.push(...visualStudio.errors);
    return result;
  }
}
