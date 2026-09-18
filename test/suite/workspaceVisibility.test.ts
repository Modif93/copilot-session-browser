import * as assert from 'assert';
import { visibleWorkspaces } from '../../src/services/workspaceVisibility';
import { Session } from '../../src/models/types';

describe('Workspace visibility for initial HTML and refresh', () => {
  const workspaces = [
    { hash: '1789519739343', label: '17895197', folderPath: '' },
    { hash: '1789522485986', label: '17895224', folderPath: '' },
    { hash: 'known', label: 'Real project', folderPath: '/work/project' },
  ];
  it('excludes anonymous empty storage while retaining known projects before sessions load', () => {
    assert.deepStrictEqual(visibleWorkspaces(workspaces, []), [workspaces[2]]);
  });
  it('retains anonymous folders only when a nonempty loaded session belongs to them', () => {
    const sessions = [
      { workspaceContext: workspaces[0].hash, messageCount: 0 },
      { workspaceContext: workspaces[1].hash, messageCount: 2 },
    ] as Session[];
    assert.deepStrictEqual(visibleWorkspaces(workspaces, sessions), [workspaces[1], workspaces[2]]);
    assert.strictEqual(workspaces.length, 3, 'raw discovery data must be preserved');
  });
});
