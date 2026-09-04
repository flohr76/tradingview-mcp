/**
 * Tests for checkForUpdate() in src/core/health.js.
 * The check compares local HEAD against origin's default branch. Differing
 * from that branch is not the same as being behind it — a checkout that is
 * ahead (feature branch, unpushed commits) must not be told to update.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkForUpdate } from '../src/core/health.js';

const LOCAL = 'e9aed5190000000000000000000000000000aaaa';
const REMOTE = '74aac0220000000000000000000000000000bbbb';

/**
 * Build DI deps simulating a git checkout.
 * @param {object} o — localSha, remoteSha, known (shas present locally),
 *                     ancestors (pairs [ancestor, descendant] that hold)
 */
function gitDeps({ localSha = LOCAL, remoteSha = REMOTE, known = [], ancestors = [] } = {}) {
  const cmds = [];
  const deps = {
    execSync: (cmd) => {
      cmds.push(cmd);
      if (cmd.includes('rev-parse HEAD')) return localSha;
      if (cmd.includes('config --get remote.origin.url')) return 'https://github.com/owner/repo.git';
      if (cmd.startsWith('git cat-file -t ')) {
        const sha = cmd.split(' ').pop();
        if (known.includes(sha)) return 'commit';
        throw new Error('bad object');
      }
      if (cmd.startsWith('git merge-base --is-ancestor ')) {
        const [a, b] = cmd.split(' ').slice(-2);
        if (ancestors.some(([x, y]) => x === a && y === b)) return '';
        throw new Error('not an ancestor');
      }
      throw new Error(`unexpected cmd: ${cmd}`);
    },
    fetchRemoteSha: async () => remoteSha,
  };
  return { deps, cmds };
}

describe('checkForUpdate() — ahead/behind', () => {
  it('reports no update when local matches the default branch', async () => {
    const { deps } = gitDeps({ localSha: REMOTE, remoteSha: REMOTE });
    const r = await checkForUpdate({ _deps: deps });
    assert.equal(r.update_available, false);
    assert.equal(r.hint, undefined);
  });

  it('reports an update when the remote commit is not in local history', async () => {
    // Nothing known locally → the remote tip is genuinely new.
    const { deps } = gitDeps();
    const r = await checkForUpdate({ _deps: deps });
    assert.equal(r.update_available, true);
    assert.match(r.hint, /tv_update/);
  });

  it('reports NO update when local is ahead of the default branch', async () => {
    // The regression: on a feature branch built on top of the default branch,
    // local != remote but the remote tip is already an ancestor of HEAD.
    const { deps } = gitDeps({ known: [REMOTE], ancestors: [[REMOTE, LOCAL]] });
    const r = await checkForUpdate({ _deps: deps });
    assert.equal(r.update_available, false);
    assert.equal(r.ahead, true);
    assert.equal(r.hint, undefined, 'must not push the user toward tv_update');
    assert.equal(r.local_commit, 'e9aed519');
    assert.equal(r.latest_commit, '74aac022');
  });

  it('still reports an update when the remote tip is unknown locally', async () => {
    // Shallow clone: ancestry is undecidable, so fall back to "update available".
    const { deps } = gitDeps({ known: [], ancestors: [[REMOTE, LOCAL]] });
    const r = await checkForUpdate({ _deps: deps });
    assert.equal(r.update_available, true);
  });
});

describe('checkForUpdate() — hostile and degraded input', () => {
  it('rejects a remote sha that is not 40 hex chars, without shelling out', async () => {
    const evil = 'aaaaaaaa; rm -rf /';
    const { deps, cmds } = gitDeps({ remoteSha: evil });
    const r = await checkForUpdate({ _deps: deps });
    assert.equal(r, null);
    assert.ok(!cmds.some(c => c.includes('rm -rf')), 'never interpolated into a git command');
  });

  it('returns null when the remote sha cannot be fetched (offline)', async () => {
    const { deps } = gitDeps();
    deps.fetchRemoteSha = async () => null;
    assert.equal(await checkForUpdate({ _deps: deps }), null);
  });

  it('returns null outside a git checkout instead of throwing', async () => {
    const { deps } = gitDeps();
    deps.execSync = () => { throw new Error('not a git repository'); };
    assert.equal(await checkForUpdate({ _deps: deps }), null);
  });
});
