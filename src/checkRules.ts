// Rule classification vocabulary for the categories selector (Context.categories
// / `ztrack check --categories`). A rule declares its `category` + `depth`
// (see core/engine.ts `Rule`); the check filters rules to those the request asks
// for. These are just the types/labels — classification is a property of each
// rule, not a lookup table.
export type RuleCategory = 'wellformed' | 'sourced' | 'code' | 'visual' | 'behavioral';
export type RuleDepth = 1 | 2 | 3;
