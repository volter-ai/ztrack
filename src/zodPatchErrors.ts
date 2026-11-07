// ZTB-21 dev/01: `ac patch`/`issue patch --json` validation errors used to be drip-fed. Passing
// an array for `proof` errored "expected object"; only on a SECOND attempt (after wrapping
// fields in the wrong place) did the operator learn the actual required shape was
// `{explanation, evidenceRefs}` — two failed round-trips to learn one contract. Nothing here is a
// hand-rolled parallel shape table (that drifts from the real schema, see configSchema.ts's
// KNOWN_KEYS comment for the shape this deliberately avoids): every hint below is read straight
// off the preset's OWN zod schema via introspection, so the FIRST error already states the full
// expected shape.
import type { z } from 'zod';

// zod v4 internals: every schema exposes `.def` (discriminated by `.def.type`) and, for objects,
// a `.shape` getter. Typed loosely here since these are implementation-internal fields, not
// zod's public API surface.
type AnyZodType = {
  def?: {
    type?: string;
    innerType?: AnyZodType;
    element?: AnyZodType;
    entries?: Record<string, unknown>;
  };
  shape?: Record<string, AnyZodType>;
};

function unwrap(schema: unknown): AnyZodType | undefined {
  let s = schema as AnyZodType | undefined;
  while (s?.def && (s.def.type === 'optional' || s.def.type === 'nullable' || s.def.type === 'default' || s.def.type === 'prefault')) {
    s = s.def.innerType;
  }
  return s;
}

/** Render a zod schema as a short type literal, e.g. `{explanation: string, evidenceRefs: string[]}`. */
export function describeZodShape(schema: unknown): string {
  const s = unwrap(schema);
  const def = s?.def;
  if (!def?.type) return 'unknown';
  switch (def.type) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'array': return `${describeZodShape(def.element)}[]`;
    case 'enum': return Object.keys(def.entries ?? {}).map((k) => JSON.stringify(k)).join(' | ');
    case 'object': {
      const shape = s!.shape ?? {};
      return `{${Object.entries(shape).map(([k, v]) => `${k}: ${describeZodShape(v)}`).join(', ')}}`;
    }
    default: return def.type;
  }
}

/** Walk a zod schema down `path` (object keys and array indices, as zod issue paths use),
 *  unwrapping optional/nullable/default at every step. Returns undefined if the path runs off
 *  a shape this can't follow (e.g. a catchall/record) — callers treat that as "no hint available". */
export function schemaAtPath(root: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let s = unwrap(root);
  for (const seg of path) {
    if (!s?.def) return undefined;
    if (typeof seg === 'number') {
      if (s.def.type !== 'array') return undefined;
      s = unwrap(s.def.element);
    } else {
      if (s.def.type !== 'object') return undefined;
      s = unwrap(s.shape?.[String(seg)]);
    }
    if (!s) return undefined;
  }
  return s;
}

/** Enhance one zod issue's default message with the full expected shape of the field it's
 *  complaining about, read from the REAL schema — so an operator learns the whole contract from
 *  the first error, not "expected object" now and "unrecognized key" one failed attempt later. */
export function describePatchIssue(rootSchema: unknown, issue: z.ZodIssue): string {
  const path = issue.path.join('.') || '(root)';
  const base = `${path}: ${issue.message}`;
  if (issue.code === 'invalid_type' && issue.expected === 'object') {
    const target = schemaAtPath(rootSchema, issue.path);
    const shape = target ? describeZodShape(target) : undefined;
    return shape ? `${base} — expected shape ${shape}` : base;
  }
  if (issue.code === 'unrecognized_keys') {
    const parent = schemaAtPath(rootSchema, issue.path) as AnyZodType | undefined;
    const parentShape = parent?.shape ?? {};
    // The likely mistake: the operator meant to nest these fields under a sibling object field
    // (e.g. `proof`) but flattened them into the parent instead. Only hint when exactly the
    // offending keys are a subset of one sibling's own shape — anything looser risks a bogus
    // suggestion.
    for (const [siblingKey, siblingSchema] of Object.entries(parentShape)) {
      const inner = unwrap(siblingSchema);
      if (inner?.def?.type !== 'object') continue;
      const innerKeys = new Set(Object.keys(inner.shape ?? {}));
      if (issue.keys.length > 0 && issue.keys.every((k) => innerKeys.has(k))) {
        return `${base} — did you mean to nest these under "${siblingKey}"? expected shape ${describeZodShape(siblingSchema)}`;
      }
    }
  }
  return base;
}
