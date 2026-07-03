// ZTB-18: cliHelp.ts unit coverage for the two remaining pieces of the ZTB-18 work order that
// don't need a subprocess: `--project`/`--remove-project` documented on create/edit (dev/40), and
// the new `api`/`migrate-local` printResourceHelp branches that make the hoisted `--help` check in
// cli.ts actually fire for those two verbs (dev/38 — the black-box side of that fix is pinned by
// cliHelpDispatch.e2e.test.ts; this pins the exact help TEXT).
import { describe, expect, test } from 'bun:test';
import { printIssueActionHelp, printResourceHelp } from './cliHelp.ts';

function captured(fn: () => boolean): { returned: boolean; out: string } {
  const orig = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = ((chunk: any) => { out += chunk; return true; }) as typeof process.stdout.write;
  try {
    return { returned: fn(), out };
  } finally {
    process.stdout.write = orig;
  }
}

describe('printIssueActionHelp: --project/--remove-project are documented (ZTB-18 dev/40)', () => {
  test('create documents --project (create honors it — markdownBackend.ts:329) but not --remove-project (create has nothing to remove)', () => {
    const { returned, out } = captured(() => printIssueActionHelp('create'));
    expect(returned).toBe(true);
    expect(out).toMatch(/--project name/);
    expect(out).not.toMatch(/--remove-project/);
  });

  test('edit documents both --project and --remove-project (edit honors both — markdownBackend.ts:342)', () => {
    const { returned, out } = captured(() => printIssueActionHelp('edit'));
    expect(returned).toBe(true);
    expect(out).toMatch(/--project name/);
    expect(out).toMatch(/--remove-project/);
  });

  test('list does NOT claim a --project filter (verified against the binary: markdownBackend.ts issue-list has no --project support)', () => {
    const { out } = captured(() => printIssueActionHelp('list'));
    expect(out).not.toMatch(/--project/);
  });

  test('create documents the title-derivation fallback (dev/40: never mint a title the preset rejects)', () => {
    const { out } = captured(() => printIssueActionHelp('create'));
    expect(out).toMatch(/derived from the body's first '# Heading' line/);
  });
});

describe('printResourceHelp: api / migrate-local branches exist (ZTB-18 dev/38)', () => {
  // commandName() names the invoking binary (bun's own argv[1] under the test runner) — not
  // literally "ztrack" — so match the shape, not the literal invocation name.
  test('api', () => {
    const { returned, out } = captured(() => printResourceHelp('api'));
    expect(returned).toBe(true);
    expect(out).toMatch(/Usage: \S+ api <query\|serve>/);
  });

  test('migrate-local', () => {
    const { returned, out } = captured(() => printResourceHelp('migrate-local'));
    expect(returned).toBe(true);
    expect(out).toMatch(/Usage: \S+ migrate-local/);
  });

  test('an unknown resource still returns false (no over-broad match)', () => {
    const { returned } = captured(() => printResourceHelp('not-a-real-resource'));
    expect(returned).toBe(false);
  });
});
