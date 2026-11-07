// The three-way merge `ztrack sync github` reconciles with: per field, what the converged value
// is, exactly like a VCS merge:
//
//     base   = the value both sides last agreed on (ztrack's baseStore)
//     fork   = the value now in the tracker
//     real   = the value now on GitHub (a fresh pull)
//
// PURE and deterministic: three resource snapshots and a policy in, a plan (per-field decisions and
// conflicts) out. No I/O; sync.ts enacts the plan (pushing fork-wins fields to GitHub, pulling
// real-wins fields into the tracker).

/** A resource as the merge sees it: its id and type, and its data fields. */
export type TwinResource = { id: string; type: string; updatedAt: string } & Record<string, unknown>;


export type ReconcilePolicy = 'hub-wins' | 'twin-wins' | 'merge';

// What happened to a single field across the three versions.
export type FieldDecision = {
  field: string;
  base: unknown;
  fork: unknown;
  real: unknown;
  // forkChanged / realChanged relative to base.
  forkChanged: boolean;
  realChanged: boolean;
  // The chosen value + why. 'conflict' means both sides changed to different
  // values and the policy could not auto-resolve (merge policy only).
  resolution: 'unchanged' | 'take-fork' | 'take-real' | 'conflict';
  value: unknown;
};

export type SubjectReconcile = {
  id: string;
  type: string;
  // present: in which versions the subject exists.
  inFork: boolean;
  inReal: boolean;
  existence: 'both' | 'fork-only' | 'real-only';
  fields: FieldDecision[];
  conflicts: FieldDecision[]; // subset of fields with resolution === 'conflict'
};

export type ReconcilePlan = {
  policy: ReconcilePolicy;
  subjects: SubjectReconcile[];
  // Direction summaries to enact later (still gated, never auto-applied here).
  toPush: Array<{ id: string; type: string; fields: Record<string, unknown> }>; // twin → real
  toPull: Array<{ id: string; type: string; fields: Record<string, unknown> }>; // real → twin
  conflictCount: number;
};

const META_FIELDS = new Set(['id', 'type', 'updatedAt']);

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function dataFields(r: TwinResource | undefined): Record<string, unknown> {
  if (!r) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (!META_FIELDS.has(k)) out[k] = v;
  return out;
}

function decideField(field: string, base: unknown, fork: unknown, real: unknown, policy: ReconcilePolicy): FieldDecision {
  const forkChanged = !eq(base, fork);
  const realChanged = !eq(base, real);
  let resolution: FieldDecision['resolution'];
  let value: unknown;

  if (!forkChanged && !realChanged) {
    resolution = 'unchanged';
    value = base;
  } else if (forkChanged && !realChanged) {
    // only the twin changed it
    resolution = policy === 'hub-wins' ? 'take-real' : 'take-fork';
    value = resolution === 'take-fork' ? fork : real;
  } else if (!forkChanged && realChanged) {
    // only the real service changed it
    resolution = policy === 'twin-wins' ? 'take-fork' : 'take-real';
    value = resolution === 'take-fork' ? fork : real;
  } else {
    // BOTH changed (relative to base) — the genuine conflict case
    if (eq(fork, real)) {
      resolution = 'take-fork'; // converged independently to the same value
      value = fork;
    } else if (policy === 'hub-wins') {
      resolution = 'take-real';
      value = real;
    } else if (policy === 'twin-wins') {
      resolution = 'take-fork';
      value = fork;
    } else {
      resolution = 'conflict'; // merge policy surfaces it; no silent pick
      value = real; // safe default: do NOT overwrite real on an unresolved conflict
    }
  }
  return { field, base, fork, real, forkChanged, realChanged, resolution, value };
}

/**
 * Compute a three-way reconciliation plan. Inputs are resource snapshots keyed
 * by id (base = at fork time, fork = twin now, real = fresh pull). Pure.
 */
export function reconcile(opts: {
  policy: ReconcilePolicy;
  base: TwinResource[];
  fork: TwinResource[];
  real: TwinResource[];
}): ReconcilePlan {
  const { policy } = opts;
  const baseById = new Map(opts.base.map((r) => [r.id, r]));
  const forkById = new Map(opts.fork.map((r) => [r.id, r]));
  const realById = new Map(opts.real.map((r) => [r.id, r]));
  const allIds = [...new Set([...forkById.keys(), ...realById.keys()])].sort();

  const subjects: SubjectReconcile[] = [];
  const toPush: ReconcilePlan['toPush'] = [];
  const toPull: ReconcilePlan['toPull'] = [];
  let conflictCount = 0;

  for (const id of allIds) {
    const baseR = baseById.get(id);
    const forkR = forkById.get(id);
    const realR = realById.get(id);
    const inFork = !!forkR;
    const inReal = !!realR;
    const existence: SubjectReconcile['existence'] = inFork && inReal ? 'both' : inFork ? 'fork-only' : 'real-only';
    const type = (forkR?.type ?? realR?.type ?? baseR?.type ?? 'unknown') as string;

    const baseF = dataFields(baseR);
    const forkF = dataFields(forkR);
    const realF = dataFields(realR);
    const fieldNames = [...new Set([...Object.keys(baseF), ...Object.keys(forkF), ...Object.keys(realF)])].sort();

    const fields = fieldNames.map((f) => decideField(f, baseF[f], forkF[f], realF[f], policy));
    const conflicts = fields.filter((d) => d.resolution === 'conflict');
    conflictCount += conflicts.length;
    subjects.push({ id, type, inFork, inReal, existence, fields, conflicts });

    // Enactment summaries (gated; not applied here):
    const pushFields: Record<string, unknown> = {};
    const pullFields: Record<string, unknown> = {};
    if (existence === 'both') {
      // field-level convergence only makes sense when the subject is on both sides:
      // - fields resolved 'take-fork' that differ from real → push to real.
      // - fields resolved 'take-real' that differ from fork → pull into twin.
      for (const d of fields) {
        if (d.resolution === 'take-fork' && !eq(d.value, d.real)) pushFields[d.field] = d.value;
        if (d.resolution === 'take-real' && !eq(d.value, d.fork)) pullFields[d.field] = d.value;
      }
    } else if (existence === 'fork-only') {
      // present in the twin, absent in real. Under twin-wins/merge that's a
      // create-on-real candidate; under hub-wins (real authoritative) the fork's
      // creation is discarded — neither pushed nor pulled.
      if (policy !== 'hub-wins') for (const [k, v] of Object.entries(forkF)) pushFields[k] = v;
    } else {
      // real-only: a create-in-twin candidate (pull) under every policy.
      for (const [k, v] of Object.entries(realF)) pullFields[k] = v;
    }

    if (Object.keys(pushFields).length > 0) toPush.push({ id, type, fields: pushFields });
    if (Object.keys(pullFields).length > 0) toPull.push({ id, type, fields: pullFields });
  }

  return { policy, subjects, toPush, toPull, conflictCount };
}

/** True when the plan can be enacted without a human decision. */
export function isCleanlyReconcilable(plan: ReconcilePlan): boolean {
  return plan.conflictCount === 0;
}
