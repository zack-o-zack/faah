import { ServiceError, errorMessage } from '../errors.ts';
import { resolveFile } from '../files/service.ts';
import { trimSpace } from '../compat/go-strings.ts';
import { GitMutations, NotFastForward } from './mutations.ts';
import type { GitWorkspace } from './workspace.ts';

export interface SyncState {
  code?: string;
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  inProgress?: string;
  dirty: boolean;
}

/** A refused pull or abort; the response carries the sync state so the panel can offer the next step. */
export class SyncConflict extends ServiceError {
  constructor(state: SyncState, message: string) {
    super('conflict', message, { ...state });
  }
}

/**
 * Git mutations behind the HTTP routes: staging, hunks, commit, push, pull,
 * abort and sync state. Each refreshes the workspace's Git state afterwards and
 * reports refusals (dirty tree, divergence) as typed errors.
 */
export class GitActions {
  readonly mutations: GitMutations;
  constructor(
    readonly workspace: GitWorkspace,
    readonly changed: (path?: string) => Promise<void>,
  ) {
    this.mutations = new GitMutations(workspace.commands, workspace.sync);
  }

  private get root(): string {
    return this.workspace.index.root;
  }

  async stage(path: string, unstage: boolean) {
    const { rel } = resolveFile(this.root, path);
    try {
      if (unstage) await this.mutations.unstage(this.root, rel);
      else await this.mutations.stage(this.root, rel);
    } catch (error) {
      throw new ServiceError('upstream', errorMessage(error));
    }
    return this.workspace.refresh();
  }

  async hunk(path: string, hunk: string, action: string) {
    const { rel } = resolveFile(this.root, path);
    if (!rel) throw new ServiceError('invalid', 'bad path');
    try {
      await this.mutations.hunk(this.root, rel, hunk, action);
    } catch (error) {
      throw new ServiceError('upstream', errorMessage(error));
    }
    if (action === 'discard') await this.changed(rel);
    await this.workspace.refresh();
    return { ok: true, path: rel, action };
  }

  async commit(message: string) {
    if (
      !(await this.mutations.staged(this.root)).length &&
      (await this.workspace.sync.dirty(this.root))
    )
      await this.mutations.stage(this.root, '.').catch(() => undefined);
    await this.mutations.commit(this.root, trimSpace(message));
    await this.workspace.refresh();
    return { ok: true };
  }

  async push() {
    let result = await this.mutations.push(this.root);
    if (result.code !== 0 && result.output.includes('has no upstream branch')) {
      const branch = await this.workspace.sync.branch(this.root);
      if (branch && branch !== 'HEAD')
        result = await this.mutations.push(this.root, 'origin', branch);
    }
    if (result.code !== 0) throw new ServiceError('upstream', trimSpace(result.output));
    await this.workspace.refresh();
    return { ok: true };
  }

  async syncState(): Promise<SyncState> {
    const sync = this.workspace.sync;
    const empty = { branch: '', upstream: '', ahead: 0, behind: 0, dirty: false };
    if (!(await this.workspace.commands.probe.get(this.root))) return empty;
    let branch = await sync.branch(this.root);
    const op = await sync.operation(this.root);
    if (op === 'rebase') branch = (await sync.rebasingBranch(this.root)) || branch;
    const upstream =
      branch && branch !== 'HEAD' ? await sync.upstream(this.root, branch) : undefined;
    const counts = await sync.aheadBehind(this.root);
    return {
      ...empty,
      branch,
      upstream: upstream ? upstream.remote + '/' + upstream.branch : '',
      ahead: counts.ahead,
      behind: counts.behind,
      dirty: await sync.dirty(this.root),
      ...(op ? { code: 'in-progress', inProgress: op } : {}),
    };
  }

  async pull() {
    const sync = this.workspace.sync;
    const op = await sync.operation(this.root);
    if (op) throw new SyncConflict(await this.syncState(), 'a ' + op + ' is already in progress');
    if (await sync.dirty(this.root))
      throw new ServiceError('conflict', 'commit or discard your local changes before pulling');
    const branch = await sync.branch(this.root);
    if (!branch || branch === 'HEAD') throw new ServiceError('invalid', 'not on a branch');
    const upstream = await sync.upstream(this.root, branch);
    if (!upstream) throw new ServiceError('invalid', 'no upstream branch configured for ' + branch);
    try {
      await this.mutations.pull(this.root, upstream.remote, upstream.branch);
    } catch (error) {
      if (!(error instanceof NotFastForward)) throw error;
      const state = { ...(await this.syncState()), code: 'diverged' };
      throw new SyncConflict(
        state,
        "can't fast-forward: " + branch + ' has diverged from ' + state.upstream,
      );
    }
    await this.changed();
    await this.workspace.refresh();
    return { ok: true, message: 'pulled the latest changes' };
  }

  async abort() {
    try {
      await this.mutations.abort(this.root);
    } catch (error) {
      throw new ServiceError('conflict', errorMessage(error));
    }
    await this.changed();
    await this.workspace.refresh();
    return { ok: true };
  }
}
