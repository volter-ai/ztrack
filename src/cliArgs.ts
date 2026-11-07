export function optionValue(args: string[], name: string, fallback = ''): string {
  // Support `--flag=value`.
  const inline = args.find((a) => a.startsWith(`${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return fallback;
  const next = args[index + 1]!;
  // A following flag-like token (`--other`) means this flag's value was omitted —
  // don't silently consume the next flag as the value.
  return next.startsWith('--') ? fallback : next;
}

// ZTB-40: `optionValue`'s repeatable sibling — every occurrence of `name` (both the space form
// `--flag value` and the `--flag=value` form), in order, rather than just the first. Same
// next-token/`--`-guard behavior as `optionValue` for the space form (a following flag-like token
// means the value was omitted, so it's skipped rather than silently consumed).
export function optionValues(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a.startsWith(`${name}=`)) { out.push(a.slice(name.length + 1)); continue; }
    if (a === name) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) out.push(next);
    }
  }
  return out;
}

/** ZTB-40: the one `--source` grammar — each occurrence may be comma-separated; occurrences
 *  and parts union, order-preserving, deduped, empties dropped. (A source whose NAME contains
 *  a comma becomes unaddressable by selector — accepted: `check` has always treated comma as a
 *  separator, and a comma-named source is pathological.) */
export function splitSelectors(occurrences: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const occ of occurrences) {
    for (const part of occ.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!seen.has(part)) { seen.add(part); out.push(part); }
    }
  }
  return out;
}
