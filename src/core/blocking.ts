// The blocking graph — a DERIVED projection over the validated root. Blocking is
// authored at two levels (acceptance criteria via `blocked-by`/`blocks`, issues via
// `relations`) and in two edge directions; this module unifies ALL of it into ONE
// directed dependency graph over a node space of both issues and ACs, and answers the
// questions a real dependency system needs: is it a DAG (no impossible cycles), which
// nodes are blocked vs actionable (transitively), and is anything completed out of
// order.
//
// Nothing here is stored: the graph is recomputed from the root, keyed by each node's
// universal id (see core/ref.ts). It is consumed by validation rules (cycle detection,
// the completion gate) AND by read-only reporting surfaces.
//
// A node's reference can target a whole issue (`{ issue }`) or a specific AC
// (`{ issue, ac }`), so blocking crosses levels freely: AC↔AC, AC↔issue, issue↔issue.

import type { BlockRef, CoreAC, CoreIssue, CoreRoot } from './engine.ts';
import { formatRef, refSegments } from './ref.ts';

// An AC is "satisfied" exactly when it is passed; every preset narrows AC status to
// include `passed` as the done state.
export const isPassed = (ac: CoreAC): boolean => ac.status === 'passed';

export interface BlockingOpts {
  // For an issue with NO acceptance criteria, "all ACs passed" is vacuously true, which
  // would wrongly count an empty issue as done. A preset supplies its terminal-state
  // check so a zero-AC issue is satisfied only when its status actually says so.
  isIssueDone?: (issue: CoreIssue) => boolean;
}

export interface BlockNode { kind: 'issue' | 'ac'; key: string; issue: CoreIssue; ac?: CoreAC }

/** The key for a block reference's target node (an issue id, or `issue:ac`). */
export function refKey(ref: BlockRef): string {
  return formatRef({ issue: ref.issue, ...(ref.ac !== undefined ? { ac: ref.ac } : {}) });
}
function nodeRef(node: BlockNode): BlockRef {
  return node.kind === 'ac' ? { issue: node.issue.id, ac: node.ac!.id } : { issue: node.issue.id };
}

/** Every node in the tracker (issues and ACs), keyed by universal id. Issue ids never
 *  contain ':' and AC keys always do, so the two key spaces never collide. */
export function nodeIndex(root: CoreRoot): Map<string, BlockNode> {
  const idx = new Map<string, BlockNode>();
  for (const issue of root.issues) {
    idx.set(issue.id, { kind: 'issue', key: issue.id, issue });
    for (const ac of issue.acceptanceCriteria) {
      const key = formatRef({ issue: issue.id, ac: ac.id });
      idx.set(key, { kind: 'ac', key, issue, ac });
    }
  }
  return idx;
}

/** A node is satisfied (a met blocker) when its work is complete: an AC when passed; an
 *  issue when all its ACs are passed — or, for an AC-less issue, when its terminal
 *  status says so (see BlockingOpts.isIssueDone). */
export function nodeSatisfied(node: BlockNode, opts: BlockingOpts = {}): boolean {
  if (node.kind === 'ac') return isPassed(node.ac!);
  const acs = node.issue.acceptanceCriteria;
  return acs.length > 0 ? acs.every(isPassed) : (opts.isIssueDone?.(node.issue) ?? false);
}

export interface GraphOpts { containment?: boolean }

/** The unified dependency graph: for each node, the set of nodes that must land before
 *  it (its direct dependencies). Edges come from every authored direction —
 *    AC `blocked-by` Y → AC depends on Y;   AC `blocks` Y → Y depends on AC;
 *    issue `blocked-by` J → issue depends on J;   issue `blocks` J → J depends on issue.
 *  With `containment`, an issue also depends on each of its own ACs ("an issue is done
 *  only when its ACs are"): this is used ONLY for cycle detection, where it surfaces
 *  cross-level deadlocks; readiness/gate omit it so an in-progress issue doesn't read as
 *  "blocked" by its own open work. Edges to non-existent nodes and self-edges are
 *  dropped (the referent/self rules report those separately). */
export function dependencyGraph(root: CoreRoot, { containment = false }: GraphOpts = {}): Map<string, Set<string>> {
  const nodes = nodeIndex(root);
  const deps = new Map<string, Set<string>>();
  for (const key of nodes.keys()) deps.set(key, new Set());
  const addEdge = (dependent: string, dependency: string) => {
    if (dependent !== dependency && nodes.has(dependent) && nodes.has(dependency)) deps.get(dependent)!.add(dependency);
  };
  for (const node of nodes.values()) {
    if (node.kind === 'issue') {
      for (const r of node.issue.relations ?? []) {
        if (r.type === 'blocked-by') addEdge(node.key, r.issueId);     // issue depends on r
        else if (r.type === 'blocks') addEdge(r.issueId, node.key);    // r depends on issue
      }
      if (containment) for (const ac of node.issue.acceptanceCriteria) addEdge(node.key, formatRef({ issue: node.issue.id, ac: ac.id }));
    } else {
      for (const r of node.ac!.blockedBy ?? []) addEdge(node.key, refKey(r)); // AC depends on r
      for (const r of node.ac!.blocks ?? []) addEdge(refKey(r), node.key);    // r depends on AC
    }
  }
  return deps;
}

/** Every dependency cycle (each a list of node keys forming a loop). A cycle is an
 *  impossible-to-satisfy constraint, so a non-empty result is a hard error. Computed
 *  with containment, so a cross-level deadlock (A's AC waits on all of B, B's AC waits
 *  on all of A) is caught. */
export function blockCycles(root: CoreRoot): string[][] {
  const deps = dependencyGraph(root, { containment: true });
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const k of deps.keys()) color.set(k, WHITE);
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const stack: string[] = [];
  const visit = (k: string) => {
    color.set(k, GRAY);
    stack.push(k);
    for (const dep of deps.get(k) ?? []) {
      if (color.get(dep) === GRAY) {
        const cycle = stack.slice(stack.indexOf(dep));
        const sig = [...cycle].sort().join('|');
        if (!seen.has(sig)) { seen.add(sig); cycles.push(cycle); }
      } else if (color.get(dep) === WHITE) {
        visit(dep);
      }
    }
    stack.pop();
    color.set(k, BLACK);
  };
  for (const k of deps.keys()) if (color.get(k) === WHITE) visit(k);
  return cycles;
}

export interface NodeBlockStatus {
  /** true when any (transitive) dependency is not yet satisfied. */
  blocked: boolean;
  /** the unsatisfied nodes upstream in the dependency closure — what's holding it up. */
  blockers: BlockRef[];
}

/** Per node, its transitive blocked state: the closure of upstream dependencies that
 *  are not yet satisfied. `blocked` is true when that set is non-empty; a node with no
 *  unmet upstream work is actionable now. Cycle-safe (each upstream node visited once)
 *  and containment-free (an issue is "blocked" only by EXTERNAL unmet work, not its own
 *  open ACs). */
export function blockStatuses(root: CoreRoot, opts: BlockingOpts = {}): Map<string, NodeBlockStatus> {
  const nodes = nodeIndex(root);
  const deps = dependencyGraph(root, { containment: false });
  const out = new Map<string, NodeBlockStatus>();
  for (const startKey of nodes.keys()) {
    const unmet = new Set<string>();
    const seen = new Set<string>();
    const walk = (k: string) => {
      for (const dep of deps.get(k) ?? []) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        if (!nodeSatisfied(nodes.get(dep)!, opts)) unmet.add(dep);
        walk(dep);
      }
    };
    walk(startKey);
    out.set(startKey, { blocked: unmet.size > 0, blockers: [...unmet].map((k) => nodeRef(nodes.get(k)!)) });
  }
  return out;
}

export interface GateViolation { node: BlockNode; dep: BlockNode }

/** Out-of-order completions: a satisfied node that directly depends on an unsatisfied
 *  one. Over the unified graph, so it fires across levels and both edge directions. */
export function completionViolations(root: CoreRoot, opts: BlockingOpts = {}): GateViolation[] {
  const nodes = nodeIndex(root);
  const deps = dependencyGraph(root, { containment: false });
  const out: GateViolation[] = [];
  for (const node of nodes.values()) {
    if (!nodeSatisfied(node, opts)) continue;
    for (const depKey of deps.get(node.key) ?? []) {
      const dep = nodes.get(depKey)!;
      if (!nodeSatisfied(dep, opts)) out.push({ node, dep });
    }
  }
  return out;
}

export interface RefProblem { issueId: string; acId: string; ref: BlockRef; kind: 'missing' | 'self' }

/** AC blocker references that don't name a real node, or that name the AC itself. */
export function blockerRefProblems(root: CoreRoot): RefProblem[] {
  const nodes = nodeIndex(root);
  const out: RefProblem[] = [];
  for (const issue of root.issues) {
    for (const ac of issue.acceptanceCriteria) {
      const selfKey = formatRef({ issue: issue.id, ac: ac.id });
      for (const ref of [...(ac.blockedBy ?? []), ...(ac.blocks ?? [])]) {
        const key = refKey(ref);
        if (key === selfKey) out.push({ issueId: issue.id, acId: ac.id, ref, kind: 'self' });
        else if (!nodes.has(key)) out.push({ issueId: issue.id, acId: ac.id, ref, kind: 'missing' });
      }
    }
  }
  return out;
}

// ── authoring helpers (parse-side) ──────────────────────────────────────────
// A blocker is authored as a bare token (an AC in this issue) or a qualified `a:b`.
// A bare token is ambiguous between a local AC and a whole issue, so the level is
// decided only once the whole tracker is known (see normalizeBlockRefs).
export interface RawBlockRef { issue: string; ac: string; bare: boolean }

/** Parse one authored blocker token against the issue it was written in. */
export function parseBlockToken(token: string, scopeIssue: string): RawBlockRef | null {
  const seg = refSegments(token);
  if (seg.length === 1) return { issue: scopeIssue, ac: seg[0]!, bare: true };
  if (seg.length === 2) return { issue: seg[0]!, ac: seg[1]!, bare: false };
  return null; // an over-qualified token is malformed
}

type ParsedIssue = { id: string; acceptanceCriteria: Array<{ id: string; blockedBy?: RawBlockRef[]; blocks?: RawBlockRef[] }> };

/** Resolve every parsed blocker to its final form, now that all issues/ACs are known.
 *  A bare token is a local AC if one exists, otherwise an issue if one exists, otherwise
 *  a (dangling) local AC the referent rule will flag. Mutates the parsed issues in place,
 *  replacing RawBlockRef with the stored BlockRef shape. */
export function normalizeBlockRefs(issues: ParsedIssue[]): void {
  const issueIds = new Set(issues.map((i) => i.id));
  const acKeys = new Set<string>();
  for (const i of issues) for (const ac of i.acceptanceCriteria) acKeys.add(formatRef({ issue: i.id, ac: ac.id }));
  const classify = (r: RawBlockRef): BlockRef => {
    if (!r.bare) return { issue: r.issue, ac: r.ac };
    if (acKeys.has(formatRef({ issue: r.issue, ac: r.ac }))) return { issue: r.issue, ac: r.ac }; // local AC
    if (issueIds.has(r.ac)) return { issue: r.ac };                                                // whole issue
    return { issue: r.issue, ac: r.ac };                                                           // dangling local AC
  };
  for (const i of issues) {
    for (const ac of i.acceptanceCriteria) {
      if (ac.blockedBy) ac.blockedBy = ac.blockedBy.map(classify) as unknown as RawBlockRef[];
      if (ac.blocks) ac.blocks = ac.blocks.map(classify) as unknown as RawBlockRef[];
    }
  }
}
