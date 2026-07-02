// preset-kit: the MECHANISM a standalone preset rents — the engine, the mdast/graph
// helpers, types, and zod. It exposes NO universal model: no shared schema, no shared
// parser, no shared rule set, no `createGenericPreset`. Each preset
// (`boilerplates/presets/*.ts`) brings its OWN schema, parser, and rules and imports
// ONLY from here. See ARCHITECTURE.md §3 (the standalone-preset invariant) and
// PRESET-GUIDE.md.

import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';

// ── engine + authoring API ───────────────────────────────────────────────────
export { rule, definePreset, check, checkRoot, deriveCoreModel } from './core/engine.ts';
// Re-exported so an installed preset imports ONLY `ztrack/preset-kit` — `zod` and the
// `mdast-*` parsers are the kit's deps, not something a consuming repo must install.
export { z } from 'zod';
export type {
  Preset, Rule, RuleRecord, DerivedModel, Located, Finding, Severity, Context, PresetContextInput,
  BlockRef, BlockerFact, CycleFact, CompletionFact, CoreRoot, IssueRecord, IssueColumns, ParseDiagnostic,
} from './core/engine.ts';
export { gitWorld, gitFileExistsAtCommit, gitCommitFiles } from './core/gitWorld.ts';
// Resolves `config.relevance` from disk so a preset's loadContext can set ctx.relevance.
export { relevanceMode } from './config.ts';
export { formatRef, BlockRefSchema } from './core/ref.ts';
// Parsing + graph mechanism a standalone preset rents to build its OWN parser/rules.
export { splitIssueBundle } from './core/bundle.ts';
export { normalizeBlockRefs, parseBlockToken } from './core/blocking.ts';
export type { RawBlockRef } from './core/blocking.ts';

// World annotations pull in `@volter-ai-dev/twin`, so they are deliberately NOT re-exported
// here — keeping preset-kit (and thus every baseline installed preset) from loading twin's
// world runtime just to parse. A preset whose loadContext uses them imports the dedicated
// `ztrack/world-annotations` subpath instead (twin is a regular dependency, always present).

// ── mdast mechanism: a standalone preset's parser walks this tree ─────────────
// The `mdast-*` deps live in the kit, not in each installed preset.
export type MdNode = { type: string; depth?: number; checked?: boolean | null; children?: MdNode[]; value?: string };

/** Build a GFM mdast tree. */
export function toMdast(markdown: string): MdNode {
  return fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as MdNode;
}

/** Recursively read the text under an mdast node. */
export function nodeText(node: MdNode): string {
  return typeof node.value === 'string' ? node.value : (node.children ?? []).map(nodeText).join('');
}
