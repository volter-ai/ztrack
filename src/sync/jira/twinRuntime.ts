// The twin packages (`@volter/world-core` + `@volter/twin-jira`) are an OPTIONAL peer, loaded lazily so a plain
// install of ztrack (peers absent) never fails to load the CLI. The same seam as sync/github/twinRuntime.ts.
export type JiraTwinRuntime = {
  twinResources: typeof import('@volter/world-core').twinResources;
  pendingActions: typeof import('@volter/world-core').pendingActions;
  readRoot: typeof import('@volter/world-core').readRoot;
  writeRoot: typeof import('@volter/world-core').writeRoot;
  performEntries: typeof import('@volter/world-core').performEntries;
  applyJiraWrite: typeof import('@volter/twin-jira').applyJiraWrite;
  handleJiraRequest: typeof import('@volter/twin-jira').handleJiraRequest;
  syncJiraFromRemote: typeof import('@volter/twin-jira').syncJiraFromRemote;
  adfToText: typeof import('@volter/twin-jira').adfToText;
  textToAdf: typeof import('@volter/twin-jira').textToAdf;
};

export const MISSING_JIRA_TWIN_MESSAGE = 'ztrack sync jira requires the optional sync packages. Install them with: npm install -D @volter/world-core @volter/twin-jira';

let cached: JiraTwinRuntime | null = null;

export async function loadJiraTwinRuntime(): Promise<JiraTwinRuntime> {
  if (cached) return cached;
  let core: typeof import('@volter/world-core');
  let jira: typeof import('@volter/twin-jira');
  try {
    [core, jira] = await Promise.all([import('@volter/world-core'), import('@volter/twin-jira')] as const);
  } catch {
    throw new Error(MISSING_JIRA_TWIN_MESSAGE);
  }
  cached = {
    twinResources: core.twinResources, pendingActions: core.pendingActions, readRoot: core.readRoot, writeRoot: core.writeRoot,
    performEntries: core.performEntries, applyJiraWrite: jira.applyJiraWrite, handleJiraRequest: jira.handleJiraRequest,
    syncJiraFromRemote: jira.syncJiraFromRemote, adfToText: jira.adfToText, textToAdf: jira.textToAdf,
  };
  return cached;
}
