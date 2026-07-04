// `issue create` stdout differs by backend: the local backend prints "<id>\t<title>", the
// markdown backend prints the created issue as JSON (`{ identifier, ... }`). Both sdk.ts
// (createTrackerClient, the public `ztrack/sdk` surface) and graphql.ts (the GraphQL `createIssue`
// resolver) parse a freshly-created issue's identifier out of that stdout the same way — this is
// the ONE shared home for that parse, so the two copies (byte-identical modulo a comment) can't
// drift apart. It lives in its own module, not in sdk.ts or graphql.ts, because sdk.ts imports
// `executeTrackerGraphql` FROM graphql.ts — graphql.ts importing this back from sdk.ts would be an
// import cycle. This standalone module has no imports of its own, so it's cycle-free for both.
// sdk.ts re-exports it under its original name to keep the public `ztrack/sdk` API unchanged.
export function identifierFromCreateOutput(stdout: string): string {
  const trimmed = stdout.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as { identifier?: unknown }).identifier === 'string') {
      return (parsed as { identifier: string }).identifier;
    }
  } catch { /* not JSON — fall through to the tab/space-delimited form */ }
  return trimmed.split(/\s+/)[0] ?? '';
}
