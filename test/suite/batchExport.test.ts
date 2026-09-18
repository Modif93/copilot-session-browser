import * as assert from 'assert';
import * as path from 'path';
import { exportSessionFiles } from '../../src/services/batchExportService';
import { ParserService } from '../../src/services/parserService';
import { ExportOptions } from '../../src/models/types';

const parser = new ParserService();
const options: ExportOptions = {
  format: 'json', includeCodeBlocks: true, includeFilePaths: false, redactSecrets: true,
};
const load = () => parser.parseFile(path.join(__dirname, '../fixtures/session-v2.json')).sessions[0];

describe('Batch folder export', () => {
  it('exports only selected sessions, with unique safe names even for identical titles and IDs', async () => {
    const session = { ...load(), title: '../../CON/한글:*?' };
    const files = new Map<string, string>();
    const result = await exportSessionFiles([session, session], options, async (name, content) => {
      assert.strictEqual(path.basename(name), name);
      assert.ok(!/[<>:"/\\|?*]/.test(name));
      assert.ok(!files.has(name));
      files.set(name, content);
    });
    assert.deepStrictEqual(result, { saved: 2, failures: [] });
    assert.strictEqual(files.size, 2);
    for (const content of files.values()) {
      const restored = parser.parseRaw(content, 'export.json');
      assert.deepStrictEqual(restored.errors, []);
      assert.deepStrictEqual(restored.sessions.map(s => s.id), [session.id]);
      assert.ok(!content.includes('AKIAIOSFODNN7EXAMPLE'));
    }
  });

  it('reports partial failures and continues writing subsequent sessions', async () => {
    const progress: number[] = [];
    let attempted = 0;
    const result = await exportSessionFiles([load(), load(), load()], options, async () => {
      if (++attempted === 2) {
        throw new Error('Disk full');
      }
    }, completed => progress.push(completed));
    assert.strictEqual(attempted, 3);
    assert.strictEqual(result.saved, 2);
    assert.strictEqual(result.failures.length, 1);
    assert.ok(result.failures[0].filename.startsWith('0002-'));
    assert.strictEqual(result.failures[0].message, 'Disk full');
    assert.deepStrictEqual(progress, [1, 2, 3]);
  });

  it('applies Markdown options to each file without mutating sessions', async () => {
    const sessions = [load(), load()];
    const before = JSON.stringify(sessions);
    const result = await exportSessionFiles(sessions, { ...options, format: 'markdown', includeCodeBlocks: false }, async (name, content) => {
      assert.ok(name.endsWith('.md'));
      assert.ok(content.startsWith('# '));
      assert.ok(!content.includes('AKIAIOSFODNN7EXAMPLE'));
      assert.ok(!content.includes('```'));
    });
    assert.strictEqual(result.saved, 2);
    assert.strictEqual(JSON.stringify(sessions), before);
  });

  it('does not write anything for an empty selection', async () => {
    const result = await exportSessionFiles([], options, async () => assert.fail('Unexpected write'));
    assert.deepStrictEqual(result, { saved: 0, failures: [] });
  });

  it('reports serialization errors without losing later sessions', async () => {
    const result = await exportSessionFiles([{ ...load(), updatedAt: new Date(NaN) }, load()], options, async () => {});
    assert.strictEqual(result.saved, 1);
    assert.strictEqual(result.failures.length, 1);
  });
});
