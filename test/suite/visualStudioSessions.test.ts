import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { encode } from '@msgpack/msgpack';
import { collectVisualStudioSessions, defaultVisualStudioPaths, parseVisualStudioSession } from '../../src/services/visualStudioSessionService';
import { ExternalSessionService } from '../../src/services/externalSessionService';
import { ExporterService } from '../../src/services/exporterService';
import { ParserService } from '../../src/services/parserService';

const fallback = new Date('2026-01-01T00:00:00Z');
// Synthetic version-1 stream based on the observed format documented in README.
const records = [
  { Name: null, TimeCreated: '2026-02-01T00:00:00Z', TimeUpdated: '2026-02-02T00:00:00Z' },
  ['Request', { Content: [['Text', { Content: 'Question 한글' }]], Model: { ModelId: 'example' } }],
  ['Response', { Content: [['Text', { Content: 'Answer\n```cs\nvar x = 1;\n```' }]], Author: 'Copilot' }],
];
const bytes = () => Buffer.concat([Buffer.from([1]), ...records.map(r => Buffer.from(encode(r)))]);

describe('Visual Studio Copilot collection', () => {
  it('sets Windows defaults without probing Windows paths on macOS', () => {
    assert.deepStrictEqual(defaultVisualStudioPaths('darwin', '/home/test', {}), { roots: [], logDirectories: [] });
    const paths = defaultVisualStudioPaths('win32', 'C:\\Users\\test', { LOCALAPPDATA: 'C:\\Local', TEMP: 'D:\\Temp' });
    assert.ok(paths.roots.includes('C:\\Users\\test\\source\\repos'));
    assert.ok(paths.logDirectories.includes('D:\\Temp\\VSGitHubCopilotLogs'));
  });

  it('parses binary messages, dates, code blocks and Windows workspace scope', () => {
    const file = 'C:\\Projects\\App\\.vs\\App.sln\\copilot-chat\\hash\\sessions\\same';
    const parsed = parseVisualStudioSession(bytes(), file, fallback);
    assert.deepStrictEqual(parsed.errors, []);
    const s = parsed.session!;
    assert.strictEqual(s.workspaceContext, 'C:/Projects/App');
    assert.strictEqual(s.title, 'Question 한글');
    assert.deepStrictEqual(s.messages.map(m => m.role), ['user', 'assistant']);
    assert.strictEqual(s.messages[1].codeBlocks[0].language, 'cs');
    assert.strictEqual(s.createdAt.toISOString(), '2026-02-01T00:00:00.000Z');
    assert.strictEqual(s.updatedAt.toISOString(), '2026-02-02T00:00:00.000Z');
    assert.strictEqual(s.messages[0].sessionId, s.id);
    assert.strictEqual(parseVisualStudioSession(bytes(), file.toLowerCase(), fallback).session!.id, s.id);
    assert.notStrictEqual(parseVisualStudioSession(bytes(), file.replace('Projects', 'Other'), fallback).session!.id, s.id);
    const exported = new ExporterService().exportAll([s], { format: 'json', includeCodeBlocks: true, includeFilePaths: true, redactSecrets: false });
    const restored = new ParserService().parseRaw(exported, 'export.json').sessions[0];
    assert.strictEqual(restored.messages[1].markdownContent, s.messages[1].markdownContent);
    assert.ok(restored.tags.includes('visual-studio'));
  });

  it('reports unsupported versions and truncated records while retaining complete messages', () => {
    assert.strictEqual(parseVisualStudioSession(Buffer.from([2, 0]), 'bad', fallback).session, undefined);
    assert.strictEqual(parseVisualStudioSession(Buffer.from([1, 0]), 'bad', fallback).session, undefined);
    const partial = parseVisualStudioSession(bytes().subarray(0, bytes().length - 3), 'partial', fallback);
    assert.ok(partial.errors.length);
    assert.strictEqual(partial.session!.messageCount, 1);
  });

  it('discovers logs and project trees, deduplicates overlaps, skips junk, and isolates corrupt files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-vs-'));
    try {
      const project = path.join(root, 'project');
      const sessions = path.join(project, '.vs', 'App.sln', 'copilot-chat', 'hash', 'sessions');
      const logDirectory = path.join(root, 'logs');
      fs.mkdirSync(sessions, { recursive: true }); fs.mkdirSync(logDirectory);
      const file = path.join(sessions, 'same');
      fs.writeFileSync(file, bytes());
      fs.writeFileSync(path.join(sessions, 'broken'), Buffer.from([9, 0]));
      fs.writeFileSync(path.join(logDirectory, 'vs.chat.log'), `Updating session file '${file}'\nUpdating session file '${file}'\nUpdating session file '${path.join(root, 'unrelated')}'`);
      fs.writeFileSync(path.join(root, 'unrelated'), bytes());
      const skip = path.join(project, 'node_modules', 'dependency', '.vs', 'App', 'copilot-chat', 'x', 'sessions');
      fs.mkdirSync(skip, { recursive: true }); fs.writeFileSync(path.join(skip, 'skip'), bytes());
      const collected = await collectVisualStudioSessions({ roots: [root, project], logDirectories: [logDirectory] });
      assert.strictEqual(collected.sessions.length, 1);
      assert.strictEqual(collected.discoveredFiles.length, 2);
      assert.strictEqual(collected.errors.length, 1);
      assert.strictEqual(collected.sessions[0].workspaceContext, fs.realpathSync(project).replace(/\\/g, '/'));
      assert.deepStrictEqual(fs.readFileSync(file), bytes());
      const logsOnly = await collectVisualStudioSessions({ roots: [], logDirectories: [logDirectory] });
      assert.strictEqual(logsOnly.discoveredFiles.length, 2, 'logs should discover sibling sessions');
      const combined = await new ExternalSessionService(root, { zedDatabase: path.join(root, 'absent.db'), jetbrainsSessionRoot: path.join(root, 'absent') }, { roots: [project], logDirectories: [] }).collect();
      assert.strictEqual(combined.sessions.length, 1);
      assert.strictEqual(combined.sessions[0].tags[0], 'visual-studio');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
