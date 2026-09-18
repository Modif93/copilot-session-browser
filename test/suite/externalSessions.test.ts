import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { defaultExternalPaths, ExternalSessionService, parseJetbrainsSession, parseZedThread } from '../../src/services/externalSessionService';
import { loadSqlJs } from '../../src/services/sqliteReaderService';
import { ExporterService } from '../../src/services/exporterService';
import { ParserService } from '../../src/services/parserService';

const date = new Date('2026-01-01T00:00:00Z');
const compressed = fs.readFileSync(path.join(__dirname, '../fixtures/external/zed-thread.zstd'));
const events = [
  { id: 'start', type: 'session.start', timestamp: date.toISOString(), data: { context: { cwd: '/code/app' } } },
  { id: 'u', type: 'user.message', timestamp: date.toISOString(), data: { content: 'Question\n```ts\nconst x = 1;\n```' } },
  { id: 'delta', type: 'assistant.message_delta', data: { deltaContent: 'Answer' } },
  { id: 'a', type: 'assistant.message', timestamp: '2026-01-02T00:00:00Z', data: { content: 'Answer' } },
].map(e => JSON.stringify(e)).join('\n');

describe('External IDE collection', () => {
  it('resolves OS defaults and XDG overrides', () => {
    assert.strictEqual(defaultExternalPaths('darwin', '/home/me', {}).zedDatabase, '/home/me/Library/Application Support/Zed/threads/threads.db');
    assert.strictEqual(defaultExternalPaths('linux', '/home/me', { XDG_DATA_HOME: '/data' }).zedDatabase, '/data/zed/threads/threads.db');
    assert.strictEqual(defaultExternalPaths('win32', 'C:\\Users\\me', { LOCALAPPDATA: 'D:\\Local' }).zedDatabase, 'D:\\Local\\Zed\\threads\\threads.db');
  });

  it('decodes compressed Zed messages and preserves primary folder order', () => {
    const s = parseZedThread({ id: 'same', data_type: 'zstd', data: compressed, folder_paths: '/a\n/b', folder_paths_order: '1,0' }, 'threads.db', date);
    assert.strictEqual(s.id, 'zed:same');
    assert.strictEqual(s.workspaceContext, '/b');
    assert.deepStrictEqual(s.messages.map(m => [m.role, m.markdownContent]), [['user', 'Example question'], ['assistant', 'Example answer']]);
    assert.ok(s.messages.every(m => m.sessionId === s.id));
  });

  it('reads legacy JSON role/segments without inventing timestamps', () => {
    const s = parseZedThread({ id: 'old', data_type: 'json', data: JSON.stringify({ messages: [{ role: 'user', segments: [{ type: 'text', text: 'Legacy' }] }] }) }, 'threads.db', date);
    assert.strictEqual(s.messages[0].markdownContent, 'Legacy');
    assert.strictEqual(s.messages[0].timestamp, undefined);
  });

  it('filters non-JetBrains clients, ignores deltas, tolerates truncated events and deduplicates', () => {
    assert.strictEqual(parseJetbrainsSession(events, { client_name: 'copilot-cli' }, 'same', 'events.jsonl', date).session, undefined);
    const parsed = parseJetbrainsSession(events + '\n' + events.split('\n')[3] + '\n{"partial":', { client_name: 'copilot-intellij' }, 'same', 'events.jsonl', date);
    const s = parsed.session!;
    assert.strictEqual(s.id, 'jetbrains-copilot:same');
    assert.strictEqual(s.workspaceContext, '/code/app');
    assert.strictEqual(s.messageCount, 2);
    assert.strictEqual(s.messages[0].codeBlocks.length, 1);
    assert.strictEqual(s.updatedAt.toISOString(), '2026-01-02T00:00:00.000Z');
    assert.strictEqual(parsed.errors.length, 1);
    const exported = new ExporterService().exportAll([s], { format: 'json', includeCodeBlocks: true, includeFilePaths: true, redactSecrets: false });
    const restored = new ParserService().parseRaw(exported, 'roundtrip.json');
    assert.strictEqual(restored.sessions[0].messages[1].markdownContent, 'Answer');
    assert.ok(restored.sessions[0].tags.includes('jetbrains-copilot'));
  });

  it('collects both sources, isolates corrupt rows/files, and never modifies source files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-external-'));
    try {
      const zedDatabase = path.join(dir, 'threads.db');
      const jetbrainsSessionRoot = path.join(dir, 'session-state');
      const SQL = await loadSqlJs(path.resolve(__dirname, '../..'));
      const db = new SQL.Database();
      db.run('CREATE TABLE threads(id TEXT, data_type TEXT, data BLOB, folder_paths TEXT)');
      db.run('INSERT INTO threads VALUES (?, ?, ?, ?)', ['same', 'zstd', compressed, '/code/zed']);
      db.run('INSERT INTO threads VALUES (?, ?, ?, ?)', ['broken', 'zstd', Buffer.from('broken'), '']);
      fs.writeFileSync(zedDatabase, db.export()); db.close();
      const before = fs.readFileSync(zedDatabase);
      for (const [name, client] of [['same', 'copilot-intellij'], ['other', 'copilot-cli']]) {
        const folder = path.join(jetbrainsSessionRoot, name);
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, 'workspace.yaml'), `client_name: ${client}\ncwd: '/code/jetbrains'\nsummary: |\n  Example title\n`);
        fs.writeFileSync(path.join(folder, 'events.jsonl'), events);
      }
      fs.mkdirSync(path.join(jetbrainsSessionRoot, 'bad'));
      fs.writeFileSync(path.join(jetbrainsSessionRoot, 'bad', 'workspace.yaml'), 'bad: [unterminated');
      const collected = await new ExternalSessionService(path.resolve(__dirname, '../..'), { zedDatabase, jetbrainsSessionRoot }, { roots: [], logDirectories: [] }).collect();
      assert.deepStrictEqual(collected.sessions.map(s => s.id).sort(), ['jetbrains-copilot:same', 'zed:same']);
      assert.strictEqual(collected.sessions.find(s => s.id.startsWith('jetbrains'))?.workspaceContext, '/code/jetbrains');
      assert.strictEqual(collected.errors.length, 2);
      assert.deepStrictEqual(fs.readFileSync(zedDatabase), before);
      assert.strictEqual(fs.readFileSync(path.join(jetbrainsSessionRoot, 'same', 'events.jsonl'), 'utf8'), events);
      const missing = await new ExternalSessionService(dir, { zedDatabase: path.join(dir, 'missing'), jetbrainsSessionRoot: path.join(dir, 'missing2') }, { roots: [], logDirectories: [] }).collect();
      assert.strictEqual(missing.sessions.length, 0);
      assert.strictEqual(missing.errors.length, 0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
