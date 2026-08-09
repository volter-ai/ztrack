// The GitHub sync provider — a self-contained module over the twin substrate. ztrack has no
// universal sync engine: each provider (github today; jira/linear later) is standalone, mirroring
// the standalone-presets design. The twin (@volter/twin*) is the shared event-sourced
// engine that makes the sync incremental + idempotent; this module is the thin adapter that maps
// ztrack issues onto it and orchestrates pull/push.
//
//   ztrack issues  <--map-->  github resources  <--twin fold/morph/egress-->  real GitHub
//
// Public surface:
//   pull(opts)            fold real GitHub -> write only changed issues to the tracker
//   push(opts)            morph the twin for changed issues -> idempotent egress to GitHub
//   resolveGithubExecute  the transport (gh CLI / token), never a prompted PAT
export { pull, push, reconcileSync, type SyncOpts, type PullResult, type PushResult, type ReconcileResult } from './sync.ts';
export { resolveGithubExecute, resolveGithubToken } from './execute.ts';
export { syncLinked, linkedRepo, linkedPolicy } from './linked.ts';
