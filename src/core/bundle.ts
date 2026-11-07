// One multi-issue markdown bundle <-> the issues in it. The loader frames every
// tracker issue into ONE bundle so a preset's parse produces the multi-issue root
// in a single pass — and cross-issue rules (duplicate IDs, dependency
// consistency, blocker rollups, global readiness) run over the whole tracker.
//
// Envelope mirrors the speckit `===FILE===` pattern: an unambiguous line marker,
// NOT an H1 split (the issue-id `# id: title` H1 is the per-issue key and bodies
// legitimately contain other headings).
const MARKER = /^===ISSUE (.+)===$/;

export function buildIssueBundle(issues: Array<{ id: string; body: string }>): string {
  // Neutralize any body line that would forge the envelope marker (a malicious or
  // self-documenting issue body containing `===ISSUE …===`) by indenting it one
  // space — markdown-insignificant, but it no longer matches the `^===ISSUE` split.
  const safe = (body: string) => body.replace(/^(===ISSUE )/gm, ' $1');
  return issues.map((i) => `===ISSUE ${i.id}===\n${safe(i.body)}`).join('\n');
}

/** Split a bundle into its issue segments. A document with no marker is treated as
 *  a single issue (back-compat: one issue per file), so per-issue parsing keeps
 *  working unchanged. */
export function splitIssueBundle(bundle: string): Array<{ id: string; body: string }> {
  if (!/^===ISSUE .+===$/m.test(bundle)) {
    return bundle.trim() ? [{ id: '', body: bundle }] : [];
  }
  const out: Array<{ id: string; body: string[] }> = [];
  let cur: { id: string; body: string[] } | null = null;
  for (const line of bundle.split('\n')) {
    const m = MARKER.exec(line);
    if (m) { if (cur) out.push(cur); cur = { id: m[1]!.trim(), body: [] }; }
    else if (cur) cur.body.push(line);
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ id: s.id, body: s.body.join('\n') }));
}
