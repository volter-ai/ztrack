// Minimal MCP (Model Context Protocol) server over stdio: the integration
// surface third-party agents use to get typechecked bookkeeping. Newline-
// delimited JSON-RPC 2.0; no SDK dependency. Tools mirror the CLI surface:
// issue read/write, scoped AC mutations, fmt, and the rulebook check.
import { checkTracker } from './check.ts';
import { summarizeResult } from './cliStyle.ts';
import { loadTrackerConfig, projectRootFrom } from './config.ts';
import { initTrackerPresets, initTrackerProject } from './presetCatalog.ts';
import { applyModelPatch, canonicalizeBody } from './modelEdit.ts';
import { viewToRecord, columnsToEdit } from './core/loader.ts';
import { resolveTrackerValidation } from './presetRegistry.ts';
import { createTrackerClient } from './sdk.ts';

type JsonRpcRequest = { jsonrpc: '2.0'; id?: number | string | null; method: string; params?: Record<string, any> };

const TOOLS = [
  {
    name: 'tracker_init',
    description: 'Initialize ztrack in the current project (writes .volter/tracker-config.json with the selected validation preset, day-one check defaults, and a managed .gitignore). Call this first in a fresh repo — the server starts without a config so an MCP-only agent can bootstrap. Idempotent.',
    inputSchema: { type: 'object', properties: {
      team: { type: 'string', description: 'team key, e.g. APP (default LOCAL)' },
      preset: { type: 'string', enum: [...initTrackerPresets()], description: 'starter preset to install as editable repo-local validation' },
    } },
  },
  {
    name: 'tracker_check',
    description: 'Validate the tracker through the single pipeline (parse → strict schema → pure rules: state gates, evidence/SHA anchoring). Returns { ok, summary, findings }; ok=false means findings must be resolved with evidence.',
    inputSchema: { type: 'object', properties: {
      issues: { type: 'string', description: 'Comma-separated case identifiers to restrict to' },
      categories: { type: 'object', description: 'Advanced preset-specific category override, if the installed validation supports it' },
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
    name: 'tracker_patch',
    description: 'Edit an issue by overlaying a typed fragment onto the issue (or one acceptance criterion, by acId) and re-serializing through the active preset. `patch` is the PRESET SCHEMA shape — call tracker_issue_view first to see it (e.g. the default preset\'s AC is {checked, status, evidence:[{id,image,commit,acVersion}], proof:{explanation,evidenceRefs}}). You never write markdown; the preset owns the grammar. Top-level keys overlay (arrays replace). The claim is verified by tracker_check, not by this call.',
    inputSchema: { type: 'object', properties: {
      issue: { type: 'string' },
      acId: { type: 'string', description: 'target one AC by id; omit to patch the issue itself' },
      patch: { type: 'object', description: 'schema-shaped fields to overlay, e.g. {"checked":true,"status":"passed"}' },
    }, required: ['issue', 'patch'] },
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
    const preset = initTrackerPresets().includes(args.preset) ? args.preset : 'default';
    const result = initTrackerProject(process.cwd(), args.team ? String(args.team) : 'LOCAL', { preset });
    return {
      configPath: result.configPath,
      alreadyInitialized: result.alreadyInitialized,
      teamKey: result.teamKey,
      preset: result.preset,
      ...(result.validationEntrypoint ? { validationEntrypoint: result.validationEntrypoint } : {}),
    };
  }
  const projectRoot = projectRootFrom();
  const client = createTrackerClient();
  switch (name) {
    case 'tracker_check': {
      const issues = args.issues ? String(args.issues).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined;
      const result = await checkTracker({
        projectRoot,
        ...(issues ? { issues } : {}),
        ...(args.categories ? { categories: args.categories } : {}),
        verifyCommits: true,
      });
      return { ok: result.ok, summary: summarizeResult(result), findings: result.findings };
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
    case 'tracker_patch': {
      const issue = await client.issue.view(String(args.issue), { json: 'identifier,title,state,stateType,assignee,labels,children,body' });
      const record = viewToRecord(issue as Record<string, unknown>, String(args.issue));
      const preset = await resolveTrackerValidation(loadTrackerConfig(projectRoot), projectRoot);
      const patch = (args.patch && typeof args.patch === 'object' && !Array.isArray(args.patch)) ? args.patch as Record<string, unknown> : {};
      const result = applyModelPatch(preset, record, { ...(args.acId ? { acId: String(args.acId) } : {}), patch });
      if (result.changed) await client.issue.edit(String(args.issue), columnsToEdit(result.body, result.columns, record));
      return { issue: args.issue, ...(args.acId ? { acId: args.acId } : {}), changed: result.changed };
    }
    case 'tracker_fmt': {
      const issue = await client.issue.view(String(args.issue), { json: 'identifier,title,state,stateType,assignee,labels,children,body' });
      const record = viewToRecord(issue as Record<string, unknown>, String(args.issue));
      const preset = await resolveTrackerValidation(loadTrackerConfig(projectRoot), projectRoot);
      const result = canonicalizeBody(preset, record);
      const canonical = result.body === record.body;
      if (args.write && !canonical) await client.issue.edit(String(args.issue), columnsToEdit(result.body, result.columns, record));
      return { issue: args.issue, canonical, ...(args.write ? { written: !canonical } : { preview: result.body }) };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

export async function serveMcp(): Promise<void> {
  const write = (message: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const MAX_LINE = 16 * 1024 * 1024; // 16 MiB per JSON-RPC line — guard against an unbounded no-newline stream
  let buffer = '';
  for await (const chunk of process.stdin) {
    buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    if (buffer.length > MAX_LINE && !buffer.includes('\n')) { buffer = ''; continue; } // drop an oversized partial line
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
