// Ambient declaration for the OPTIONAL `@volter/twin` peer dependency.
//
// ztrack's world-integration adapters (`src/worldAnnotations.ts`,
// `src/worldSourceBooks.ts`, and the `annotations` CLI command) read a mirrored
// world through `@volter/twin`'s generic event surface. `@volter/twin` is a separate
// volter-ai project; when it is installed, its real types apply. This loose
// declaration only exists so ztrack typechecks standalone when twin is absent — it is
// intentionally permissive, not authoritative.
//
// NOTE: this file is stripped from the vendored copy by `scripts/ztrack-sync-in.sh`
// in consumers that already have a real `@volter/twin`, so it never shadows the real
// package's types.
declare module '@volter/twin' {
  export interface WorldServiceEvent {
    id: string;
    service: string;
    type: string;
    origin: string;
    occurredAt: string;
    // payload shapes vary per service; the adapters read them defensively.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subject?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    external?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actor?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    raw?: any;
    [k: string]: unknown;
  }
  export interface WorldServiceConfig {
    [k: string]: unknown;
  }
  export interface WorldConfig {
    services: Record<string, WorldServiceConfig>;
    [k: string]: unknown;
  }
  export interface WorldValidationFinding {
    level: string;
    code: string;
    message: string;
    [k: string]: unknown;
  }
  export interface WorldValidationReport {
    findings: WorldValidationFinding[];
    [k: string]: unknown;
  }

  export const DELTA_TYPE_SUFFIX: string;
  export function discoverWorldServices(root?: string): string[];
  export function isEgressEventType(type: string): boolean;
  export function listEvents(service: string, root?: string): WorldServiceEvent[];
  export function loadWorldConfig(root?: string): WorldConfig;
  export function summarizeWorldFindings(findings: WorldValidationFinding[]): WorldValidationReport;
  export function worldStateRoot(root?: string): string;
}
