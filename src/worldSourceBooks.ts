// Tracker-side adapter: maps world events/annotations → tracker "source books"
// (the event→requirement-source view the tracker presets consume). This lived in
// `@volter/twin` and was its last tracker coupling; moved here so the world stays
// a pure twin runtime (strategy/world-twins-architecture.md → decouple sourceBooks).
// It reads world data through `@volter/twin`'s generic surface only.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { listEvents, loadWorldConfig, worldStateRoot } from '@volter/twin';
import type { WorldServiceConfig, WorldServiceEvent } from '@volter/twin';
import { listAnnotations } from './worldAnnotations.ts';
import type { WorldAnnotation } from './worldAnnotations.ts';

// `browseUrlTemplate` is a tracker/source concern layered on the world's generic
// per-service config (carried via its index signature) — owned + typed here.
type SourceServiceConfig = WorldServiceConfig & { browseUrlTemplate?: string };

export type WorldSourceBookMessage = {
  message_id: string;
  team?: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  user?: string;
  user_name?: string;
  text: string;
  datetime_utc: string;
  source: string;
  metadata: Record<string, unknown>;
};

export type WorldSourceBookAnnotation = {
  message_id: string;
  classification: string;
  issue?: string;
  linear_issue?: string;
  target?: string;
  quote?: string;
  annotator: string;
  source: string;
  world_annotation_id: string;
  world_event_id: string;
  created_at: string;
};

export type WorldSourceBooks = {
  messages: WorldSourceBookMessage[];
  annotations: WorldSourceBookAnnotation[];
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberString(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return stringValue(value);
}

function serviceNames(root?: string): string[] {
  const worldRoot = worldStateRoot(root);
  if (!existsSync(worldRoot)) return [];
  return readdirSync(worldRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function providerForEvent(event: WorldServiceEvent): string {
  if (event.service === 'chat') return 'chat';
  if (event.service === 'jira') return 'jira';
  if (event.service === 'github') return 'github';
  return stringValue(event.external?.provider) || event.service;
}

// Browse URLs come from the service's configured browseUrlTemplate (world
// config), never from a hardcoded provider domain.
function jiraBrowseUrl(event: WorldServiceEvent, serviceConfig?: SourceServiceConfig): string {
  const template = stringValue(serviceConfig?.browseUrlTemplate);
  if (!template) return '';
  const rawIssue = isObject(event.raw?.issue) ? event.raw.issue : {};
  const key = stringValue(event.data.issueKey)
    || stringValue(event.data.key)
    || stringValue(rawIssue.key)
    || (/^[A-Z][A-Z0-9]+-\d+$/.test(stringValue(event.external?.id)) ? stringValue(event.external?.id) : '')
    || (/^[A-Z][A-Z0-9]+-\d+$/.test(stringValue(event.subject.id)) ? stringValue(event.subject.id) : '');
  return key ? template.replaceAll('{id}', key) : '';
}

function collectText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(collectText).filter(Boolean).join(' ');
  if (!isObject(value)) return '';
  return [
    typeof value.text === 'string' ? value.text : '',
    collectText(value.content),
  ].filter(Boolean).join(' ');
}

function eventText(event: WorldServiceEvent, serviceConfig?: SourceServiceConfig): string {
  if (event.service === 'jira') {
    const rawIssue = isObject(event.raw?.issue) ? event.raw.issue : {};
    const rawFields = isObject(rawIssue.fields) ? rawIssue.fields : {};
    const rawComment = isObject(event.raw?.comment) ? event.raw.comment : {};
    return [
      stringValue(event.external?.id) || stringValue(event.subject.id) || stringValue(event.data.key),
      stringValue(event.external?.url),
      jiraBrowseUrl(event, serviceConfig),
      stringValue(event.data.text),
      stringValue(event.data.summary),
      stringValue(event.data.status),
      stringValue(event.data.issueType),
      collectText(rawFields.description),
      collectText(rawComment.body),
    ].filter(Boolean).join('\n');
  }
  if (event.service === 'github') {
    const rawPullRequest = isObject(event.raw?.pull_request) ? event.raw.pull_request : {};
    const rawComment = isObject(event.raw?.comment) ? event.raw.comment : {};
    const rawReview = isObject(event.raw?.review) ? event.raw.review : {};
    const repository = stringValue(event.data.repository) || stringValue(event.data.repo);
    const number = numberString(event.data.number);
    return [
      repository && number ? `${repository}#${number}` : '',
      stringValue(event.external?.url),
      stringValue(event.data.title),
      stringValue(event.data.body),
      stringValue(rawPullRequest.title),
      stringValue(rawPullRequest.body),
      stringValue(rawComment.body),
      stringValue(rawReview.body),
    ].filter(Boolean).join('\n');
  }
  return stringValue(event.data.text)
    || stringValue(event.data.summary)
    || stringValue(event.data.body)
    || stringValue(event.data.title);
}

function splitExternalId(provider: string, id: string): { channel: string; ts: string } {
  if (provider === 'jira') return { channel: 'jira', ts: id.replace(/^jira:/, '') };
  const [channel, ts] = id.split(':', 2);
  return { channel: channel || provider, ts: ts || id };
}

function messageIdForEvent(event: WorldServiceEvent): string {
  return stringValue(event.external?.id) || stringValue(event.subject.id) || event.id;
}

function messageForEvent(event: WorldServiceEvent, serviceConfig?: SourceServiceConfig): WorldSourceBookMessage | null {
  const text = eventText(event, serviceConfig);
  if (!text) return null;
  const provider = providerForEvent(event);
  const messageId = messageIdForEvent(event);
  const split = splitExternalId(provider, messageId);
  const channel = stringValue(event.data.channel) || split.channel || event.service;
  const ts = numberString(event.data.ts) || split.ts || event.occurredAt;
  return {
    message_id: messageId,
    team: stringValue(event.data.team) || undefined,
    channel,
    ts,
    thread_ts: numberString(event.data.thread_ts) || numberString(event.data.threadTs) || ts,
    user: stringValue(event.data.user) || event.actor?.id,
    user_name: stringValue(event.data.user_name) || event.actor?.name,
    text,
    datetime_utc: event.occurredAt,
    source: provider,
    metadata: {
      worldEventId: event.id,
      service: event.service,
      eventType: event.type,
      origin: event.origin,
      provider,
      externalUrl: event.external?.url,
    },
  };
}

function sourceClassification(annotation: WorldAnnotation): string {
  const metadata = isObject(annotation.metadata) ? annotation.metadata : {};
  return stringValue(metadata.sourceClassification) || stringValue(metadata.legacyClassification) || annotation.classification;
}

function sourceTarget(annotation: WorldAnnotation): string {
  const metadata = isObject(annotation.metadata) ? annotation.metadata : {};
  return stringValue(metadata.sourceTarget) || stringValue(metadata.legacyTarget);
}

function sourceIssue(annotation: WorldAnnotation): string {
  const metadata = isObject(annotation.metadata) ? annotation.metadata : {};
  return stringValue(metadata.sourceIssue) || stringValue(metadata.legacyIssue);
}

function annotationRowsForEvent(
  annotation: WorldAnnotation,
  event: WorldServiceEvent,
): WorldSourceBookAnnotation[] {
  const provider = providerForEvent(event);
  const base = {
    message_id: messageIdForEvent(event),
    classification: sourceClassification(annotation),
    quote: annotation.quote,
    annotator: annotation.annotator,
    source: provider,
    world_annotation_id: annotation.id,
    world_event_id: annotation.eventId,
    created_at: annotation.createdAt,
  };
  const issue = sourceIssue(annotation);
  if (!issue) return [{ ...base, target: sourceTarget(annotation) }];
  return [{
    ...base,
    issue,
    linear_issue: issue,
    target: sourceTarget(annotation),
  }];
}

export function loadWorldSourceBooks(root?: string): WorldSourceBooks {
  const messages = new Map<string, WorldSourceBookMessage>();
  const annotations: WorldSourceBookAnnotation[] = [];
  const worldConfig = loadWorldConfig(root);
  for (const service of serviceNames(root)) {
    const serviceConfig = worldConfig.services[service] as SourceServiceConfig | undefined;
    const events = listEvents(service, root);
    const eventsById = new Map(events.map((event) => [event.id, event]));
    const serviceAnnotations = listAnnotations(service, root);
    const sourceBookRelevantEventIds = new Set(serviceAnnotations.flatMap((annotation) => {
      if (service === 'chat') return [annotation.eventId];
      const projectsToSourceBook = annotation.classification === 'source';
      return projectsToSourceBook
        ? [annotation.eventId]
        : [];
    }));
    for (const event of events) {
      if (event.service !== 'chat' && !sourceBookRelevantEventIds.has(event.id)) continue;
      const message = messageForEvent(event, serviceConfig);
      if (message) messages.set(message.message_id, message);
    }
    for (const annotation of serviceAnnotations) {
      const event = eventsById.get(annotation.eventId);
      if (!event) continue;
      if (event.service !== 'chat' && !sourceBookRelevantEventIds.has(event.id)) continue;
      if (!messageForEvent(event, serviceConfig)) continue;
      annotations.push(...annotationRowsForEvent(annotation, event));
    }
  }
  return {
    messages: [...messages.values()].sort((a, b) => `${a.source}:${a.channel}:${a.ts}`.localeCompare(`${b.source}:${b.channel}:${b.ts}`)),
    annotations: annotations.sort((a, b) => `${a.message_id}:${a.issue ?? ''}:${a.target ?? ''}`.localeCompare(`${b.message_id}:${b.issue ?? ''}:${b.target ?? ''}`)),
  };
}
