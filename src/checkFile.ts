// Zero-config `ztrack check <file.md>` — the eslint-style front door. Point it at any
// issue-markdown file and it validates with the bundled `basic` preset: no `init`, no
// backend, no team key. Commit citations are verified against the CURRENT git repo (cwd),
// so the red→green moment (`commit: <fake>` fails, a real SHA passes) works out of the box.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { compileFunction } from 'node:vm';
import * as presetKit from './presetKit.ts';
import { installedPresetTemplate, type InitTrackerPreset } from './config.ts';
import { buildIssueBundle } from './core/bundle.ts';
import { buildContext, renderIssueMarkdown } from './core/loader.ts';
import { check, type CheckResult, type CoreRoot } from './core/engine.ts';
import type { Preset } from './core/engine.ts';

// Compile the bundled preset.cjs in-process, injecting the already-loaded preset-kit as
// its `require('ztrack/preset-kit')` — so it resolves with no on-disk install or temp file.
export function loadBundledPreset(variant: InitTrackerPreset = 'basic'): Preset<CoreRoot> {
  const source = installedPresetTemplate(variant);
  const fn = compileFunction(source, ['exports', 'require', 'module', '__filename', '__dirname'], {
    filename: `ztrack-bundled-${variant}-preset.cjs`,
  });
  const moduleObj = { exports: {} as Record<string, unknown> };
  const req = (id: string): unknown => {
    if (id === 'ztrack/preset-kit') return presetKit;
    throw new Error(`bundled ${variant} preset: unexpected require(${JSON.stringify(id)})`);
  };
  fn(moduleObj.exports, req, moduleObj, `ztrack-bundled-${variant}-preset.cjs`, process.cwd());
  const loaded = moduleObj.exports as { preset?: unknown; default?: unknown };
  return (loaded.preset ?? loaded.default ?? loaded) as Preset<CoreRoot>;
}

const H1_RE = /^#\s+(.+)$/m;

// One markdown file → the same self-contained issue document the loader frames from a
// backend row: a `type:case` issue (so the case/AC rules apply) whose body is the file.
// Workflow metadata (assignee/state) is synthesized — file mode validates the BODY's
// claims (acceptance criteria, evidence, commit citations), not who a ticket is assigned to,
// so we supply a placeholder assignee rather than flag its absence on a standalone file.
function fileToIssue(file: string, index: number): { id: string; body: string } {
  const text = readFileSync(file, 'utf8');
  const title = (H1_RE.exec(text)?.[1] ?? basename(file).replace(/\.md$/i, '')).trim();
  return renderIssueMarkdown({
    identifier: `CHECK-${index + 1}`, title, body: text, assignee: 'file',
    state: 'In Progress', stateType: 'open', labels: ['type:case'],
  });
}

export interface CheckFilesOptions { projectRoot: string; verifyCommits?: boolean }

/** Validate one or more issue-markdown files with the bundled `basic` preset. */
export async function checkMarkdownFiles(files: string[], options: CheckFilesOptions): Promise<CheckResult<CoreRoot>> {
  const preset = loadBundledPreset('basic');
  const bundle = buildIssueBundle(files.map((file, i) => fileToIssue(file, i)));
  const context = await buildContext(preset, bundle, {
    projectRoot: options.projectRoot,
    verifyCommits: options.verifyCommits ?? true,
  });
  return check(preset, bundle, context);
}
