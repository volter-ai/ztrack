// The ONE shared issue-id minting rule: the max numeric SUFFIX seen so far across every
// configured source (any prefix) plus one — NOT scoped per-prefix — so a fresh mint never
// collides with any id anywhere in the tracker. `backends/markdownBackend.ts`'s `issue create`
// handler and `importBacklog.ts`'s batch importer both mint ids and MUST agree byte-identically
// (see docsConsistency-adjacent test `idAllocator.test.ts`'s both-paths-mint-the-same-id pin) —
// this is the one place that rule is implemented; previously it was duplicated (a live inline
// reduce in markdownBackend.ts's create handler, and this class in importBacklog.ts, whose own
// comment admitted it "Mirrors MarkdownBackend's own minting rule").
export class IdAllocator {
  private maxSuffix = 0;
  /** Record an existing id (from any source, or already present in a file being imported) so a
   *  later `next()` never collides with it. */
  note(id: string): void {
    const n = Number(id.split('-').pop());
    if (Number.isFinite(n) && n > this.maxSuffix) this.maxSuffix = n;
  }
  next(prefix: string): string {
    this.maxSuffix += 1;
    return `${prefix}-${this.maxSuffix}`;
  }
}
