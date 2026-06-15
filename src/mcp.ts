// Minimal MCP (Model Context Protocol) server over stdio: the integration
// surface third-party agents use to get typechecked bookkeeping. Newline-
// delimited JSON-RPC 2.0; no SDK dependency. Tools mirror the CLI surface:
// issue read/write, scoped AC mutations, fmt, and the rulebook check.
import { checkTrackerSnapshot } from './check.ts';
import { initTrackerProject, projectRootFrom } from './config.ts';
import { exportTrackerSnapshot } from './export.ts';
import { canonicalizeIssueMarkdown } from './markdownModel.ts';
import { applyAcMutation, addEvidenceEntry } from './mutate.ts';
import type { AcStatus, EvidenceSpec } from './mutate.ts';
import { createTrackerClient } from './sdk.ts';

type JsonRpcRequest = { jsonrpc: '2.0'; id?: number | string | null; method: string; params?: Record<string, any> };

const TOOLS = [
  {
    name: 'tracker_init',
    description: 'Initialize ztrack in the current project (writes .volter/tracker-config.json with the generic validation preset, day-one check defaults, and a managed .gitignore). Call this first in a fresh repo — the server starts without a config so an MCP-only agent can bootstrap. Idempotent.',
    inputSchema: { type: 'object', properties: { team: { type: 'string', description: 'team key, e.g. APP (default LOCAL)' } } },
  },
  {
    name: 'tracker_check',
    description: 'Export the tracker snapshot and run the full verification rulebook (state gates, evidence/SHA anchoring). Returns the report; valid=false means findings must be resolved with evidence.',
    inputSchema: { type: 'object', properties: {
      issues: { type: 'string', description: 'Comma-separated case identifiers to restrict to' },
      categories: { type: 'object', description: 'Per-category depth override, e.g. {"code":3} (default: config)' },
    } },
  },
  {
    name: 'tracker_issue_list',
    description: 'List tracker issues (state filter optional).',
    inputSchema: { type: 'object', properties: {
      state: { type: 'string' }, limit: { type: 'number' },
    } },
  },
  {
    name: 'tracker_issue_view',
    description: 'View one issue including its body.',
    inputSchema: { type: 'object', properties: { issue: { type: 'string' } }, required: ['issue'] },
  },
  {
    name: 'tracker_issue_create',
    description: 'Create an issue.',
    inputSchema: { type: 'object', properties: {
      title: { type: 'string' }, body: { type: 'string' }, state: { type: 'string' },
      assignee: { type: 'string' },
      labels: { type: 'array', items: { type: 'string' } },
    }, required: ['title'] },
  },
  {
    name: 'tracker_ac_check',
    description: 'Check an acceptance criterion: scoped body mutation that sets status passed, records the commit, references evidence by id, and stamps AC-Version. `evidence`/`proof` are ID refs like ["E1"] (create the entries first with tracker_evidence_add) — NOT entry text. The claim is verified by tracker_check, not by this call.',
    inputSchema: { type: 'object', properties: {
      issue: { type: 'string' }, acId: { type: 'string' },
      commit: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' }, description: 'evidence id refs, e.g. ["E1"]' },
      proof: { type: 'array', items: { type: 'string' } },
    }, required: ['issue', 'acId'] },
  },
  {
    name: 'tracker_evidence_add',
    description: 'Add a resolvable evidence entry ([En]) to the issue\'s Evidence section and return its id. Use this BEFORE tracker_ac_check, then pass the returned id in ac_check\'s `evidence`. type=pr needs repo/number/head; screenshot needs path (a real image committed in the repo) + justification; video needs url + status + justification.',
    inputSchema: { type: 'object', properties: {
      issue: { type: 'string' }, type: { type: 'string', enum: ['pr', 'screenshot', 'video', 'golden-pr'] },
      ac: { type: 'string' }, repo: { type: 'string' }, number: { type: 'string' }, head: { type: 'string' },
      state: { type: 'string' }, path: { type: 'string' }, url: { type: 'string' }, status: { type: 'string' }, justification: { type: 'string' },
    }, required: ['issue', 'type'] },
  },
  {
    name: 'tracker_ac_uncheck',
    description: 'Uncheck an acceptance criterion (strips commit/evidence claims, resets to pending).',
    inputSchema: { type: 'object', properties: { issue: { type: 'string' }, acId: { type: 'string' } }, required: ['issue', 'acId'] },
  },
  {
    name: 'tracker_ac_set_status',
    description: 'Set an acceptance criterion status (pending|passed|failed|stale|blocked|descoped).',
    inputSchema: { type: 'object', properties: { issue: { type: 'string' }, acId: { type: 'string' }, status: { type: 'string' } }, required: ['issue', 'acId', 'status'] },
  },
  {
    name: 'tracker_fmt',
    description: 'Canonicalize an issue body (whitespace, checkbox markers, section order). write=false previews.',
    inputSchema: { type: 'object', properties: { issue: { type: 'string' }, write: { type: 'boolean' } }, required: ['issue'] },
  },
];

async function callTool(name: string, args: Record<string, any>): Promise<unknown> {
  // tracker_init runs before client creation: in a fresh repo there is no
  // config yet, and creating the client loads config (which would throw).
  if (name === 'tracker_init') {
    const result = initTrackerProject(process.cwd(), args.team ? String(args.team) : 'LOCAL');
    return { configPath: result.configPath, alreadyInitialized: result.alreadyInitialized, teamKey: result.teamKey };
  }
  const projectRoot = projectRootFrom();
  const client = createTrackerClient();
  switch (name) {
    case 'tracker_check': {
      const issues = args.issues ? String(args.issues).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined;
      const snapshot = exportTrackerSnapshot({ projectRoot, ...(issues ? { issues } : {}) });
      return checkTrackerSnapshot(snapshot, {
        projectRoot,
        ...(issues ? { issues } : {}),
        ...(args.categories ? { categories: args.categories } : {}),
      });
    }
    case 'tracker_issue_list':
      return client.issue.list({ ...(args.state ? { state: args.state } : {}), limit: args.limit ?? 20, json: 'identifier,title,state' });
    case 'tracker_issue_view':
      return client.issue.view(String(args.issue), { json: 'identifier,title,state,labels,body' });
    case 'tracker_issue_create':
      return client.issue.create({
        title: String(args.title),
        ...(args.body ? { body: args.body } : {}),
        ...(args.state ? { state: args.state } : {}),
        ...(args.assignee ? { assignee: String(args.assignee) } : {}),
        ...(args.labels ? { labels: args.labels } : {}),
      });
    case 'tracker_ac_check':
    case 'tracker_ac_uncheck':
    case 'tracker_ac_set_status': {
      const issue = await client.issue.view(String(args.issue), { json: 'body' });
      const body = String((issue as Record<string, unknown>).body ?? '');
      // Coerce evidence/proof to a string[] of refs: accept an array, OR a
      // single string (a comma/space-separated list, e.g. "E1,E2" or "E1") —
      // an agent passing a bare string must NOT be char-iterated into a corrupt
      // [E] marker (the G7 finding). Reject other shapes loudly.
      const toRefs = (v: unknown): string[] | undefined => {
        if (v === undefined || v === null) return undefined;
        const arr = Array.isArray(v) ? v.map(String) : String(v).split(/[,\s]+/);
        return arr.map((s) => s.trim()).filter(Boolean);
      };
      const evidence = toRefs(args.evidence);
      const proof = toRefs(args.proof);
      const result = name === 'tracker_ac_check'
        ? applyAcMutation(body, { op: 'check', acId: String(args.acId), ...(args.commit ? { commit: String(args.commit) } : {}), ...(evidence?.length ? { evidence } : {}), ...(proof?.length ? { proof } : {}) })
        : name === 'tracker_ac_uncheck'
          ? applyAcMutation(body, { op: 'uncheck', acId: String(args.acId) })
          : applyAcMutation(body, { op: 'set-status', acId: String(args.acId), status: String(args.status) as AcStatus });
      await client.issue.edit(String(args.issue), { body: result.body });
      return { issue: args.issue, acId: result.acId, changed: result.changed, itemAfter: result.itemAfter };
    }
    case 'tracker_evidence_add': {
      const issue = await client.issue.view(String(args.issue), { json: 'body' });
      const body = String((issue as Record<string, unknown>).body ?? '');
      const spec = { type: String(args.type) } as EvidenceSpec;
      for (const key of ['ac', 'repo', 'number', 'head', 'state', 'path', 'url', 'status', 'justification'] as const) {
        if (args[key] !== undefined) (spec as Record<string, unknown>)[key] = String(args[key]);
      }
      const result = addEvidenceEntry(body, spec);
      await client.issue.edit(String(args.issue), { body: result.body });
      return { issue: args.issue, evidenceId: result.evidenceId };
    }
    case 'tracker_fmt': {
      const issue = await client.issue.view(String(args.issue), { json: 'body' });
      const body = String((issue as Record<string, unknown>).body ?? '');
      const formatted = canonicalizeIssueMarkdown(body);
      if (args.write && formatted !== body) await client.issue.edit(String(args.issue), { body: formatted });
      return { issue: args.issue, canonical: formatted === body, ...(args.write ? { written: formatted !== body } : { preview: formatted }) };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

export async function serveMcp(): Promise<void> {
  const write = (message: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(message)}\n`);
  let buffer = '';
  for await (const chunk of process.stdin) {
    buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(line) as JsonRpcRequest;
      } catch {
        continue;
      }
      if (request.id === undefined || request.id === null) continue; // notification
      try {
        if (request.method === 'initialize') {
          write({ jsonrpc: '2.0', id: request.id, result: {
            protocolVersion: request.params?.protocolVersion ?? '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'ztrack', version: '0.4.0' },
          } });
        } else if (request.method === 'tools/list') {
          write({ jsonrpc: '2.0', id: request.id, result: { tools: TOOLS } });
        } else if (request.method === 'tools/call') {
          const result = await callTool(String(request.params?.name), request.params?.arguments ?? {});
          write({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
        } else if (request.method === 'ping') {
          write({ jsonrpc: '2.0', id: request.id, result: {} });
        } else {
          write({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `method not found: ${request.method}` } });
        }
      } catch (error) {
        write({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } });
      }
    }
  }
}
