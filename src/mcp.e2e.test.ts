// Drive the real `ztrack mcp serve` stdio server — the agent-facing usage mode. Spawns it, speaks
// line-delimited JSON-RPC (initialize / tools/list / tools/call), and asserts the tracker tools
// actually work against a real tracker. Black-box + subprocess-isolated like the other CLI e2es.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const CLI = join(import.meta.dir, 'cli.ts');
let root = '';

// One MCP session: write the requests, collect a response per request (matched by id), then stop.
function mcpSession(requests: Array<Record<string, unknown>>, timeoutMs = 25_000): Promise<Map<unknown, any>> {
  return new Promise((resolve) => {
    const proc = spawn('bun', ['run', CLI, 'mcp', 'serve'], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });
    const byId = new Map<unknown, any>();
    let buf = '';
    const done = () => { clearTimeout(timer); try { proc.kill(); } catch { /* */ } resolve(byId); };
    const timer = setTimeout(done, timeoutMs);
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line) { try { const m = JSON.parse(line); byId.set(m.id, m); } catch { /* */ } }
      }
      if (byId.size >= requests.length) done();
    });
    for (const r of requests) proc.stdin.write(`${JSON.stringify(r)}\n`);
  });
}

describe('mcp serve — the agent-facing stdio server', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ztrk-mcp-'));
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(REPO, join(root, 'node_modules', 'ztrack'));
    const zt = (...a: string[]) => spawnSync('bun', ['run', CLI, ...a], { cwd: root, encoding: 'utf8' });
    zt('init');
    writeFileSync(join(root, 'b.md'), zt('issue', 'scaffold', '--title', 'First').stdout);
    zt('issue', 'create', '--title', 'First', '--label', 'type:case', '--state', 'draft', '--assignee', 'me', '--body-file', 'b.md');
  }, 30_000);
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  // text payload of a tools/call result, parsed as JSON (the tracker tools return JSON text).
  const toolJson = (r: Map<unknown, any>, id: number) => JSON.parse(r.get(id)?.result?.content?.[0]?.text ?? 'null');

  test('protocol: initialize + tools/list expose the tracker tools', async () => {
    const r = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    expect(r.get(1)?.result?.serverInfo?.name).toBe('ztrack');
    const tools = (r.get(2)?.result?.tools ?? []).map((t: { name: string }) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['tracker_check', 'tracker_issue_list', 'tracker_issue_view', 'tracker_issue_create', 'tracker_patch', 'tracker_fmt']));
  }, 30_000);

  test('a real DEVELOP loop over MCP: list → check passes → create a bad issue → check CATCHES it', async () => {
    const r = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tracker_issue_list', arguments: {} } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'tracker_check', arguments: {} } },                         // baseline: green
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'tracker_issue_create', arguments: { title: 'Bad' } } },   // minimal create (no state) — an incomplete issue
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'tracker_check', arguments: {} } },                         // now: caught
    ]);

    expect(r.get(1)?.result?.content?.[0]?.text).toMatch(/LOCAL-1/);        // list shows the seeded issue
    expect(toolJson(r, 2).ok).toBe(true);                                   // check actually evaluates → a green tracker PASSES
    expect(r.get(3)?.result?.content?.[0]?.text).toMatch(/LOCAL-2|identifier/); // the create landed (a new issue)

    const after = toolJson(r, 4);
    expect(after.ok).toBe(false);                                          // the MCP write changed the world AND re-check saw it
    expect(JSON.stringify(after.findings)).toMatch(/issues\.1|LOCAL-2/);   // a real finding on the new (incomplete) issue
  }, 30_000);
});
