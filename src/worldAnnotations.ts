// World annotations — a TRACKER concern, not a twin one.
//
// An annotation is the tracker's interpretation over an immutable world event:
// "this event is a `source` (a requirement), `noise`, or a `duplicate`", with an
// exact quote that must resolve into the event payload. That classification is
// verification vocabulary — using the mirrored world as an *evidence substrate* is
// the tracker's decision, so this lives here, not in `@volter/twin`. It reads the
// world only through `@volter/twin`'s generic event surface and stores annotations
// alongside the events they describe (`.volter/world/<service>/annotations.jsonl`).
//
// `@volter/twin` is loaded LAZILY (dynamic import, only when a function here actually
// runs) via `./worldTwinRuntime.ts` — this module is a PUBLIC subpath export
// (`ztrack/world-annotations`), so a consumer without the optional twin peer installed must get
// a friendly error, not a raw ESM resolution crash. See worldTwinRuntime.ts for the full
// rationale (mirrors src/sync/github/twinRuntime.ts's seam for `ztrack sync github`).
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { WorldConfig, WorldServiceConfig, WorldServiceEvent, WorldValidationFinding } from '@volter/twin';
import { loadTwinWorldRuntime } from './worldTwinRuntime.ts';

export { MISSING_WORLD_TWIN_MESSAGE } from './worldTwinRuntime.ts';

// The annotation/source config the tracker layers on the world's generic per-service
// config (carried via its index signature). These fields are verification concerns,
// owned + typed here, not in @volter/twin.
type AnnotationServiceConfig = WorldServiceConfig & {
  annotationPolicy?: 'required' | 'exempt';
  browseUrlTemplate?: string;
};

export const WorldAnnotationSchema = z.object({
  id: z.string().min(1),
  service: z.string().min(1),
  eventId: z.string().min(1),
  classification: z.enum(['source', 'noise', 'duplicate']),
  quote: z.string().min(1).optional(),
  payloadPath: z.string().min(1).optional(),
  resourcePath: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  annotator: z.enum(['agent', 'human']),
  createdAt: z.string().min(1),
});
export type WorldAnnotation = z.infer<typeof WorldAnnotationSchema>;

async function annotationsPath(service: string, root?: string): Promise<string> {
  const twin = await loadTwinWorldRuntime();
  return join(twin.worldStateRoot(root), service, 'annotations.jsonl');
}
function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  // Tolerate a corrupt/partial line (skip it) so one bad row in an append-only log
  // can't break reading annotations (addAnnotation, source books, etc.). Integrity
  // validation surfaces malformed lines separately (see validateServiceAnnotations).
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).flatMap((l) => {
    try { return [JSON.parse(l) as T]; } catch { return []; }
  });
}

export function createAnnotation(input: Omit<WorldAnnotation, 'createdAt'> & { createdAt?: string }): WorldAnnotation {
  return WorldAnnotationSchema.parse({ createdAt: new Date().toISOString(), ...input });
}

export async function listAnnotations(service: string, root?: string): Promise<WorldAnnotation[]> {
  return readJsonl<unknown>(await annotationsPath(service, root)).map((row) => WorldAnnotationSchema.parse(row));
}

/** Append an annotation. Idempotent on id; refuses to annotate a missing event. */
export async function addAnnotation(annotation: WorldAnnotation, root?: string): Promise<WorldAnnotation> {
  const parsed = WorldAnnotationSchema.parse(annotation);
  const twin = await loadTwinWorldRuntime();
  if (!twin.listEvents(parsed.service, root).some((e) => e.id === parsed.eventId)) {
    throw new Error(`Cannot annotate missing ${parsed.service} event: ${parsed.eventId}`);
  }
  if ((await listAnnotations(parsed.service, root)).some((a) => a.id === parsed.id)) return parsed;
  appendFileSync(await annotationsPath(parsed.service, root), `${JSON.stringify(parsed)}\n`);
  return parsed;
}

/**
 * True when an event must NOT be routed through the annotation pipeline — a
 * mechanical sync record: egress ledger events, connector-origin deltas, or any
 * event of a service whose world config sets annotationPolicy: 'exempt'.
 */
export async function isAnnotationExemptEvent(event: WorldServiceEvent, config?: WorldConfig): Promise<boolean> {
  const twin = await loadTwinWorldRuntime();
  if (twin.isEgressEventType(event.type)) return true;
  if (event.type.endsWith(twin.DELTA_TYPE_SUFFIX) && event.origin === 'connector') return true;
  if ((config?.services[event.service] as AnnotationServiceConfig | undefined)?.annotationPolicy === 'exempt') return true;
  return false;
}

// ── annotation integrity validation (was validateWorldService in @volter/twin) ──
type JsonObject = Record<string, unknown>;
const isObject = (v: unknown): v is JsonObject => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const stringValue = (v: unknown): string => (typeof v === 'string' ? v : '');
function collectText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(collectText).filter(Boolean).join('\n');
  if (!isObject(value)) return '';
  return Object.values(value).map(collectText).filter(Boolean).join('\n');
}
function browseUrl(event: WorldServiceEvent, serviceConfig?: AnnotationServiceConfig): string {
  const template = stringValue(serviceConfig?.browseUrlTemplate);
  if (!template) return '';
  const key = stringValue(event.external?.id) || stringValue(event.subject.id) || stringValue(event.data.key);
  return key ? template.replaceAll('{id}', key) : '';
}
function eventText(event: WorldServiceEvent, serviceConfig?: AnnotationServiceConfig): string {
  return [event.id, event.external?.id, event.external?.url, browseUrl(event, serviceConfig), collectText(event.data), collectText(event.raw)].filter(Boolean).join('\n');
}
async function rawAnnotationRows(root: string, service: string): Promise<JsonObject[]> {
  const file = await annotationsPath(service, root);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      const row = JSON.parse(line) as unknown;
      if (!isObject(row)) throw new Error('expected object');
      return [row];
    } catch (error) { return [{ id: `${service}:malformed:${index + 1}`, __parseError: (error as Error).message }]; }
  });
}

/** Validate every annotation in a service: schema, quote resolution, links, unannotated events. */
export async function validateServiceAnnotations(root: string, service: string): Promise<WorldValidationFinding[]> {
  const findings: WorldValidationFinding[] = [];
  const twin = await loadTwinWorldRuntime();
  const events = twin.listEvents(service, root);
  for (const [index, row] of (await rawAnnotationRows(root, service)).entries()) {
    if ('__parseError' in row) {
      findings.push({ level: 'error', code: 'annotation_malformed_json', message: 'Annotation JSONL row is malformed.', service, annotation: stringValue(row.id) || `${service}:row:${index + 1}`, details: { row: index + 1, error: stringValue(row.__parseError) } });
      continue;
    }
    if ('target' in row || 'targets' in row) {
      findings.push({ level: 'error', code: 'annotation_has_case_target', message: 'World annotation contains retired case target data; case usage must live in the case source row.', service, annotation: stringValue(row.id) || `${service}:row:${index + 1}` });
    }
    const parsed = WorldAnnotationSchema.safeParse(row);
    if (!parsed.success) {
      findings.push({ level: 'error', code: 'annotation_schema_invalid', message: 'Annotation does not match the current world annotation schema.', service, annotation: stringValue(row.id) || `${service}:row:${index + 1}`, details: { issues: parsed.error.issues.map((i) => i.message) } });
    }
  }
  if (findings.some((f) => f.level === 'error')) return findings;

  const annotations = await listAnnotations(service, root);
  const eventsById = new Map(events.map((e) => [e.id, e]));
  const annotatedEventIds = new Set(annotations.map((a) => a.eventId));
  const annotationIds = new Set<string>();
  const worldConfig = twin.loadWorldConfig(root);
  const serviceConfig = worldConfig.services[service] as AnnotationServiceConfig | undefined;
  for (const event of events) {
    if (annotatedEventIds.has(event.id) || (await isAnnotationExemptEvent(event, worldConfig))) continue;
    findings.push({ level: 'warning', code: 'event_unannotated', message: 'World event has no annotation. An ingress agent must inspect the raw event and write a source or noise annotation.', service, event: event.id, details: { eventType: event.type, occurredAt: event.occurredAt, externalUrl: stringValue(event.external?.url), subject: event.subject } });
  }
  for (const annotation of annotations) {
    if (annotationIds.has(annotation.id)) findings.push({ level: 'error', code: 'annotation_duplicate_id', message: 'Annotation id appears more than once.', service, annotation: annotation.id });
    annotationIds.add(annotation.id);
    const event = eventsById.get(annotation.eventId);
    if (!event) {
      findings.push({ level: 'error', code: 'annotation_event_missing', message: 'Annotation references an event absent from the service event log.', service, annotation: annotation.id, event: annotation.eventId });
      continue;
    }
    if (event.service !== annotation.service) findings.push({ level: 'error', code: 'annotation_service_mismatch', message: 'Annotation service does not match the referenced event service.', service, annotation: annotation.id, event: event.id, details: { annotationService: annotation.service, eventService: event.service } });
    if (annotation.quote && !eventText(event, serviceConfig).includes(annotation.quote)) findings.push({ level: 'error', code: 'annotation_quote_missing_from_event', message: 'Annotation quote is not present in the referenced event payload.', service, annotation: annotation.id, event: event.id, details: { quote: annotation.quote } });
    if (annotation.payloadPath && !existsSync(resolve(root, annotation.payloadPath))) findings.push({ level: 'error', code: 'annotation_payload_missing', message: 'Annotation payloadPath does not exist.', service, annotation: annotation.id, details: { payloadPath: annotation.payloadPath } });
    if (annotation.resourcePath && !existsSync(resolve(twin.worldStateRoot(root), service, annotation.resourcePath))) findings.push({ level: 'error', code: 'annotation_resource_missing', message: 'Annotation resourcePath does not exist.', service, annotation: annotation.id, details: { resourcePath: annotation.resourcePath } });
  }
  return findings;
}
