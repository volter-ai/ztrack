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
  BlockRef, BlockerFact, CycleFact, CompletionFact, CoreRoot,
} from './core/engine.ts';
export { gitWorld } from './core/gitWorld.ts';
export { formatRef, BlockRefSchema } from './core/ref.ts';
// Parsing + graph mechanism a standalone preset rents to build its OWN parser/rules.
export { splitIssueBundle } from './core/bundle.ts';
export { normalizeBlockRefs, parseBlockToken } from './core/blocking.ts';
export type { RawBlockRef } from './core/blocking.ts';

// World annotations live behind the `@volter-ai-dev/twin` PEER dependency, so they are
// deliberately NOT re-exported here (that would force every installed preset to resolve
// `twin` just to load). A preset whose loadContext uses them imports the dedicated
// `ztrack/world-annotations` subpath instead.

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
