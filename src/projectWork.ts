import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { basename } from 'node:path';
import { MarkdownBackend } from './backends/markdownBackend.ts';
import {
  boardScope,
  gitCommonDir,
  isLinkedTracker,
  loadTrackerConfig,
  projectRootFrom,
  stateDirName,
} from './config.ts';
import { git } from './core/gitWorld.ts';
import { matchIssueIdsInName, resolveActiveIssue } from './core/scope.ts';
import { readLoopMarker, type LoopMarker } from './loopState.ts';
import { resolveSources } from './sources.ts';

export interface ZtrackProjectIdentity {
  projectRoot: string;
  projectKey: string;
  scope: 'shared' | 'worktree';
}

export interface WorkTargetSignal {
  source: 'environment' | 'loop' | 'branch' | 'worktree';
  issueIds: string[];
  detail: string;
}

export interface WorkTargetResolution {
  project: ZtrackProjectIdentity;
  effective: {
    issueId: string;
    source: WorkTargetSignal['source'];
  } | null;
  signals: WorkTargetSignal[];
  reason: string;
}

function existingRealpath(path: string): string {
  try { return realpathSync(path); } catch { return path; }
}

function projectKey(scopeRoot: string, trackerLocator: string): string {
  const digest = createHash('sha256')
    .update('ztrack-project-v1\0')
    .update(scopeRoot)
    .update('\0')
    .update(trackerLocator)
    .digest('hex')
    .slice(0, 32);
  return `zt-${digest}`;
}

/** Resolve identity from the same storage-scope decisions the tracker backend uses. */
export function resolveProjectIdentity(startDir: string): ZtrackProjectIdentity {
  const discoveredRoot = projectRootFrom(startDir);
  // Loading is also the loud missing/invalid-config gate. `projectRootFrom` intentionally falls
  // back to startDir for general CLI use; an identity must never bless that fallback as a tracker.
  const config = loadTrackerConfig(discoveredRoot);
  const projectRoot = existingRealpath(discoveredRoot);
  const commonDir = gitCommonDir(projectRoot);
  // Only the default source participates in the shared board/cache machinery. A declared source
  // elsewhere in the worktree can diverge by branch, so a mixed/custom-source tracker must not
  // collapse those different Markdown stores under one key even when `board: shared` is set.
  const allSourcesUseSharedStorage = resolveSources(projectRoot, config).every((source) => source.isDefault);
  const shared = !!commonDir
    && allSourcesUseSharedStorage
    && (isLinkedTracker(projectRoot) || boardScope(projectRoot) === 'shared');
  if (!shared) {
    return {
      projectRoot,
      projectKey: projectKey(projectRoot, `${stateDirName()}/tracker-config.json`),
      scope: 'worktree',
    };
  }

  // `--show-prefix` is stable across linked worktrees and distinguishes two nested trackers in
  // one repository. The common-dir realpath makes different worktrees of the same clone join,
  // while a moved/recloned checkout is honestly a new identity.
  const prefix = git(projectRoot, ['rev-parse', '--show-prefix']).replace(/\/$/, '') || '.';
  const trackerLocator = `${prefix}/${stateDirName()}/tracker-config.json`;
  const scopeRoot = existingRealpath(commonDir);
  return { projectRoot, projectKey: projectKey(scopeRoot, trackerLocator), scope: 'shared' };
}

function trackerIssueIds(projectRoot: string): string[] {
  const config = loadTrackerConfig(projectRoot);
  if (config.backend === 'local') {
    throw new Error(
      'This project uses the removed Python `local` backend. Run `ztrack migrate-local` before resolving project work.',
    );
  }
  const backend = new MarkdownBackend(
    projectRoot,
    config.local?.teamKey ?? 'PH',
    resolveSources(projectRoot, config),
  );
  return backend.issueIds();
}

function namedSignal(
  source: 'branch' | 'worktree',
  name: string | undefined,
  issueIds: string[],
): WorkTargetSignal | null {
  if (!name) return null;
  const matched = matchIssueIdsInName(name, issueIds);
  if (matched.length === 0) return null;
  return {
    source,
    issueIds: matched,
    detail: matched.length === 1
      ? `matched ${matched[0]} in ${source} '${name}'`
      : `${source} '${name}' matches ${matched.join(', ')}`,
  };
}

function loopSignal(
  marker: LoopMarker | null,
  issueIds: string[],
  branch: string | undefined,
  worktree: string | undefined,
): WorkTargetSignal | null {
  if (!marker) return null;
  if (marker.target.kind === 'issues') {
    return {
      source: 'loop',
      issueIds: [...new Set(marker.target.ids)],
      detail: marker.target.ids.length === 1
        ? `loop is armed for ${marker.target.ids[0]}`
        : `loop is armed for multiple issues: ${marker.target.ids.join(', ')}`,
    };
  }
  if (marker.target.kind !== 'auto') return null;
  const resolved = resolveActiveIssue({ branch, worktree, issueIds });
  return {
    source: 'loop',
    issueIds: resolved.issueId ? [resolved.issueId] : [],
    detail: `loop is armed for this branch: ${resolved.reason}`,
  };
}

/** Resolve an observational work target. The caller must pass any session-attested environment
 * issue explicitly; this function never reads the host process's ZTRACK_ACTIVE_ISSUE. */
export function resolveWorkTarget(input: {
  startDir: string;
  environmentIssue?: string;
}): WorkTargetResolution {
  const project = resolveProjectIdentity(input.startDir);
  const issueIds = trackerIssueIds(project.projectRoot);
  const branch = git(project.projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) || undefined;
  const top = git(project.projectRoot, ['rev-parse', '--show-toplevel']);
  const worktree = top ? basename(top) : undefined;
  const environmentIssue = input.environmentIssue?.trim() || undefined;
  const marker = readLoopMarker(project.projectRoot);

  const signals: WorkTargetSignal[] = [];
  if (environmentIssue) {
    signals.push({
      source: 'environment',
      issueIds: [environmentIssue],
      detail: issueIds.includes(environmentIssue)
        ? `environment pinned to ${environmentIssue}`
        : `environment issue '${environmentIssue}' is not in the tracker`,
    });
  }
  const loop = loopSignal(marker, issueIds, branch, worktree);
  if (loop) signals.push(loop);
  const branchSignal = namedSignal('branch', branch, issueIds);
  if (branchSignal) signals.push(branchSignal);
  const worktreeSignal = namedSignal('worktree', worktree, issueIds);
  if (worktreeSignal) signals.push(worktreeSignal);

  // Precedence intentionally matches the CLI gate: explicit environment, armed loop, then
  // branch/worktree. Unknown or ambiguous higher-precedence evidence fails closed.
  if (environmentIssue) {
    const resolution = resolveActiveIssue({ explicit: environmentIssue, issueIds });
    return {
      project,
      effective: resolution.issueId ? { issueId: resolution.issueId, source: 'environment' } : null,
      signals,
      reason: resolution.reason,
    };
  }
  if (loop) {
    if (loop.issueIds.length === 1 && issueIds.includes(loop.issueIds[0]!)) {
      return {
        project,
        effective: { issueId: loop.issueIds[0]!, source: 'loop' },
        signals,
        reason: loop.detail,
      };
    }
    return {
      project,
      effective: null,
      signals,
      reason: loop.issueIds.length > 1
        ? `ambiguous: armed loop names ${loop.issueIds.join(', ')}`
        : loop.issueIds.length === 1
          ? `loop issue '${loop.issueIds[0]}' is not in the tracker`
          : loop.detail,
    };
  }
  const resolution = resolveActiveIssue({ branch, worktree, issueIds });
  const effectiveSource = resolution.issueId
    ? (branchSignal?.issueIds.length === 1 && branchSignal.issueIds[0] === resolution.issueId ? 'branch' : 'worktree')
    : null;
  return {
    project,
    effective: resolution.issueId && effectiveSource
      ? { issueId: resolution.issueId, source: effectiveSource }
      : null,
    signals,
    reason: resolution.reason,
  };
}
