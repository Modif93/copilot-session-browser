import * as assert from 'assert';
import * as path from 'path';
import { ParserService } from '../../src/services/parserService';
import { ExporterService } from '../../src/services/exporterService';
import { SessionWithMessages } from '../../src/models/types';

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const parser = new ParserService();
const exporter = new ExporterService();

function loadSession(fixture: string, index = 0): SessionWithMessages {
  const result = parser.parseFile(path.join(FIXTURES, fixture));
  assert.ok(result.sessions.length > index, `No session at index ${index}`);
  return result.sessions[index];
}

const DEFAULT_OPTS = {
  includeCodeBlocks: true,
  includeFilePaths: false,
  redactSecrets: false,
};

describe('ExporterService – Export All', () => {
  it('round-trips multiple sessions and their transcripts through one JSON file', () => {
    const sessions = [loadSession('session-v1.json'), loadSession('session-v2.json')];
    const output = exporter.exportAll(sessions, { ...DEFAULT_OPTS, format: 'json' });
    const restored = parser.parseRaw(output, 'all-sessions.json');
    assert.deepStrictEqual(restored.errors, []);
    assert.strictEqual(restored.sessions.length, sessions.length);
    for (const [i, session] of sessions.entries()) {
      const actual = restored.sessions[i];
      assert.strictEqual(actual.id, session.id);
      assert.strictEqual(actual.title, session.title);
      assert.strictEqual(actual.createdAt.toISOString(), session.createdAt.toISOString());
      assert.deepStrictEqual(actual.tags, session.tags);
      assert.deepStrictEqual(actual.messages, session.messages);
    }
  });

  it('includes every session in Markdown and applies code-block exclusion', () => {
    const sessions = [loadSession('session-v1.json'), loadSession('session-v2.json')];
    const output = exporter.exportAll(sessions, {
      ...DEFAULT_OPTS, format: 'markdown', includeCodeBlocks: false,
    });
    for (const session of sessions) {
      assert.ok(output.includes(`# ${session.title}`));
      assert.ok(output.includes(session.id));
    }
    assert.ok(!output.includes('```'));
  });

  it('redacts every session without mutating the source index', () => {
    const session = loadSession('session-v2.json');
    const sessions = [session, { ...session, id: 'second-session' }];
    const before = JSON.stringify(sessions);
    for (const format of ['json', 'markdown'] as const) {
      const output = exporter.exportAll(sessions, { ...DEFAULT_OPTS, format, redactSecrets: true });
      assert.ok(!output.includes('AKIAIOSFODNN7EXAMPLE'));
      assert.ok(output.includes('[REDACTED'));
    }
    assert.strictEqual(JSON.stringify(sessions), before);
  });

  it('round-trips an empty collection and a session with no messages', () => {
    const options = { ...DEFAULT_OPTS, format: 'json' as const };
    const empty = parser.parseRaw(exporter.exportAll([], options), 'empty.json');
    assert.deepStrictEqual(empty.errors, []);
    assert.deepStrictEqual(empty.sessions, []);
    const session = { ...loadSession('session-v1.json'), messages: [], messageCount: 0 };
    const restored = parser.parseRaw(exporter.exportAll([session], options), 'empty-session.json');
    assert.deepStrictEqual(restored.errors, []);
    assert.strictEqual(restored.sessions.length, 1);
    assert.strictEqual(restored.sessions[0].messageCount, 0);
  });

  it('reports invalid collection entries while retaining valid sessions', () => {
    const session = loadSession('session-v1.json');
    const data = JSON.parse(exporter.exportAll([session], { ...DEFAULT_OPTS, format: 'json' }));
    data.sessions.push(null, { id: 'broken' });
    const restored = parser.parseRaw(JSON.stringify(data), 'mixed.json');
    assert.strictEqual(restored.sessions.length, 1);
    assert.strictEqual(restored.errors.length, 2);
  });
});

// ── Standard Markdown ─────────────────────────────────────────────────────────

describe('ExporterService – Standard Markdown', () => {
  it('starts with # heading', () => {
    const session = loadSession('session-v1.json');
    const output = exporter.export(session, { ...DEFAULT_OPTS, format: 'markdown' });
    assert.ok(output.startsWith('#'), `Got: ${output.slice(0, 50)}`);
  });

  it('includes session ID in metadata table', () => {
    const session = loadSession('session-v1.json');
    const output = exporter.export(session, { ...DEFAULT_OPTS, format: 'markdown' });
    assert.ok(output.includes(session.id));
  });

  it('includes role headings with **bold**', () => {
    const session = loadSession('session-v1.json');
    const output = exporter.export(session, { ...DEFAULT_OPTS, format: 'markdown' });
    assert.ok(output.includes('**User**') || output.includes('**Copilot**'));
  });

  it('uses --- separators between messages', () => {
    const session = loadSession('session-v1.json');
    const output = exporter.export(session, { ...DEFAULT_OPTS, format: 'markdown' });
    assert.ok(output.includes('\n---\n'));
  });
});

// ── JSON ──────────────────────────────────────────────────────────────────────

describe('ExporterService – JSON', () => {
  it('is valid JSON', () => {
    const session = loadSession('session-v1.json');
    const output = exporter.export(session, { ...DEFAULT_OPTS, format: 'json' });
    assert.doesNotThrow(() => JSON.parse(output));
  });

  it('exports schema version 4', () => {
    const session = loadSession('session-v1.json');
    const output = exporter.export(session, { ...DEFAULT_OPTS, format: 'json' });
    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.schemaVersion, '4');
  });

  it('round-trips through parser', () => {
    const original = loadSession('session-v1.json');
    const json = exporter.export(original, { ...DEFAULT_OPTS, format: 'json' });

    const re = parser.parseRaw(json, 'roundtrip.json');
    assert.strictEqual(re.errors.length, 0, `Errors: ${re.errors.join(', ')}`);
    assert.strictEqual(re.sessions.length, 1);

    const restored = re.sessions[0];
    assert.strictEqual(restored.id, original.id);
    assert.strictEqual(restored.title, original.title);
    assert.strictEqual(restored.messageCount, original.messageCount);
  });

  it('includes exportedAt timestamp', () => {
    const session = loadSession('session-v4.json');
    const output = exporter.export(session, { ...DEFAULT_OPTS, format: 'json' });
    const parsed = JSON.parse(output);
    assert.ok(typeof parsed.exportedAt === 'string');
    assert.ok(new Date(parsed.exportedAt).getTime() > 0);
  });

  it('excludes code blocks when disabled', () => {
    const session = loadSession('session-v1.json');
    const output = exporter.export(session, {
      ...DEFAULT_OPTS,
      format: 'json',
      includeCodeBlocks: false,
    });
    const parsed = JSON.parse(output);
    for (const msg of parsed.messages) {
      assert.deepStrictEqual(msg.codeBlocks, [], 'codeBlocks should be empty array');
    }
  });

  it('redacts secrets in content when requested', () => {
    const session = loadSession('session-v2.json');
    const output = exporter.export(session, {
      ...DEFAULT_OPTS,
      format: 'json',
      redactSecrets: true,
    });
    assert.ok(!output.includes('AKIAIOSFODNN7EXAMPLE'), 'AWS key should be redacted in JSON');
  });
});

// ── defaultFilename ───────────────────────────────────────────────────────────

describe('ExporterService – defaultFilename', () => {
  it('returns .md for markdown format', () => {
    const session = loadSession('session-v1.json');
    const name = exporter.defaultFilename(session, 'markdown');
    assert.ok(name.endsWith('.md'), name);
  });

  it('returns .json for json format', () => {
    const session = loadSession('session-v1.json');
    const name = exporter.defaultFilename(session, 'json');
    assert.ok(name.endsWith('.json'), name);
  });

  it('includes slugified title', () => {
    const session = loadSession('session-v1.json');
    const name = exporter.defaultFilename(session, 'json');
    // Title is "TypeScript Error Fix" → "typescript-error-fix"
    assert.ok(name.includes('typescript') || name.includes('copilot'), name);
  });
});
