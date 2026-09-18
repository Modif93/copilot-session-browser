import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

describe('Workspace export menu', () => {
  function setup() {
    const elements = new Map<string, any>();
    const messages: any[] = [];
    const windowHandlers: Record<string, (event: any) => void> = {};
    function element(id: string): any {
      if (!elements.has(id)) {
        elements.set(id, {
          style: {}, dataset: {}, textContent: '', value: '', innerHTML: '',
          offsetWidth: 220, offsetHeight: 36,
          handlers: {} as Record<string, (event: any) => void>,
          classList: { add() {}, remove() {}, toggle() {} },
          addEventListener(type: string, callback: (event: any) => void) { this.handlers[type] = callback; },
          focus() {}, contains() { return false; }, querySelectorAll() { return []; },
        });
      }
      return elements.get(id);
    }
    const workspaces = [{ folderPath: 'C:/work/project', hash: 'abc123', label: 'project' }];
    element('__ws_data__').textContent = JSON.stringify(workspaces);
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../media/sessionList.js'), 'utf8'), {
      acquireVsCodeApi: () => ({ postMessage: (message: any) => messages.push(message) }),
      document: { getElementById: element, querySelectorAll: () => [], addEventListener() {} },
      window: { innerWidth: 400, innerHeight: 500,
        addEventListener: (type: string, callback: (event: any) => void) => { windowHandlers[type] = callback; } },
      console,
    });
    windowHandlers.message({ data: { type: 'sessions', discoveredWorkspaces: workspaces, items: [
      { tags: [], title: 'Path', id: 'path', workspaceContext: 'file:///C:/work/project' },
      { tags: [], title: 'Hash', id: 'hash', workspaceContext: 'ABC123' },
      { tags: [], title: 'Other', id: 'other', workspaceContext: 'C:/work/other' },
    ] } });
    function open(key: string) {
      let prevented = false;
      element('workspace-list').handlers.contextmenu({
        preventDefault() { prevented = true; }, stopPropagation() {}, clientX: 390, clientY: 490,
        target: { closest: () => ({ dataset: { key } }) },
      });
      assert.ok(prevented, 'native copy/paste menu must be suppressed');
    }
    return { element, messages, open, receive: windowHandlers.message };
  }

  it('hides anonymous empty folders in All and removes stale entries after refresh', () => {
    const { element, receive } = setup();
    receive({ data: { type: 'sessions', discoveredWorkspaces: [
      { folderPath: '', hash: '1789519739343', label: '17895197' },
      { folderPath: '', hash: '1789522485986', label: '17895224' },
      { folderPath: 'C:/work/empty', hash: 'real', label: 'Empty project' },
    ], items: [{ id: 'anonymous', title: 'Chat', tags: [], workspaceContext: '1789522485986', messageCount: 1 }] } });
    element('ws-filter-bar').handlers.click({ target: { closest: () => ({ dataset: { wsfilter: 'all' } }) } });
    const html = element('workspace-list').innerHTML;
    assert.ok(!html.includes('17895197'));
    assert.ok(html.includes('17895224'));
    assert.ok(html.includes('Empty project'));
    receive({ data: { type: 'sessions', discoveredWorkspaces: [], items: [] } });
    assert.ok(!element('workspace-list').innerHTML.includes('17895224'));
    assert.ok(!element('workspace-list').innerHTML.includes('Empty project'));
  });

  it('shows projects absent from VS Code workspace discovery', () => {
    const { element } = setup();
    assert.ok(element('workspace-list').innerHTML.includes('C:/work/other'));
    assert.ok(element('workspace-list').innerHTML.includes('2 sessions'));
  });

  it('limits toolbar export after navigation and resets it on Back or All Sessions', () => {
    const { element, messages } = setup();
    const select = (key: string) => element('workspace-list').handlers.click({
      target: { closest: () => ({ dataset: { key } }) },
    });
    select('C:/work/project');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(messages.pop())), {
      type: 'exportScope', sessionIds: ['path', 'hash'],
    });
    element('btn-back').handlers.click();
    assert.strictEqual(messages.pop().sessionIds, null);
    select('C:/work/empty');
    assert.strictEqual(messages.pop().sessionIds.length, 0);
    select('__all__');
    assert.strictEqual(messages.pop().sessionIds, null);
  });

  it('exports path and hash matches only, and hides session-specific actions', () => {
    const { element, messages, open } = setup();
    open('C:/work/project');
    assert.strictEqual(element('ctx-view').style.display, 'none');
    assert.strictEqual(element('ctx-export-workspace').style.display, '');
    assert.strictEqual(element('ctx-menu').style.left, '180px');
    element('ctx-export-workspace').handlers.click();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(messages.pop())), {
      type: 'exportWorkspace', sessionIds: ['path', 'hash'],
    });
  });

  it('keeps an empty workspace export empty instead of selecting all sessions', () => {
    const { element, messages, open } = setup();
    open('C:/work/empty');
    element('ctx-export-workspace').handlers.click();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(messages.pop())), {
      type: 'exportWorkspace', sessionIds: [],
    });
  });
});
