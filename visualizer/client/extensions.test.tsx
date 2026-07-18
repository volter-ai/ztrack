// Pure-logic unit tests for VIZ-4's extension builder — no DOM runtime needed here (ReactNode
// members are asserted via `renderToStaticMarkup`); the DOM-runtime e2e tests live in
// `render.e2e.test.tsx`.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildEffectiveExtension, registerExtension, UPGRADE_NOTICE } from './extensions';
import type { CoreAC, CoreIssue, Payload } from './model';

function issue(overrides: Partial<CoreIssue> & Record<string, unknown> = {}): CoreIssue {
  return { id: 'X-1', title: 't', summary: '', status: 'draft', acceptanceCriteria: [], ...overrides } as CoreIssue;
}
function ac(overrides: Partial<CoreAC> & Record<string, unknown> = {}): CoreAC {
  return { id: 'ac/01', status: 'pending', evidence: [], ...overrides } as CoreAC;
}
function payload(overrides: Partial<Payload> = {}): Payload {
  return {
    title: 'tracker', preset: 'simple-sdlc', projectDir: '/x', fetchedAt: 'now', trackerChangedAt: null, ok: true,
    primitives: {}, visualizer: null, operationalBlocking: {}, issues: [], findings: [], audit: {}, timestamps: {}, ...overrides,
  };
}

describe('buildEffectiveExtension', () => {
  test('query-isolated module instances share one extension registry', () => {
    const script = `
      const registering = await import('./visualizer/client/extensions.tsx?register');
      const consuming = await import('./visualizer/client/extensions.tsx?consume');
      registering.registerExtension('query-isolated', { blockedViewLabel: 'shared registry' });
      const payload = { title: 'tracker', preset: 'query-isolated', projectDir: '/x', fetchedAt: 'now', trackerChangedAt: null, ok: true, primitives: {}, visualizer: null, operationalBlocking: {}, issues: [], findings: [], audit: {}, timestamps: {} };
      if (consuming.buildEffectiveExtension(payload).ext.blockedViewLabel !== 'shared registry') process.exit(1);
    `;
    const result = spawnSync('bun', ['-e', script], { cwd: new URL('../..', import.meta.url), encoding: 'utf8' });
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  test('null payload (still loading): no notice yet, empty statusOrder', () => {
    const { ext, notice } = buildEffectiveExtension(null);
    expect(notice).toBeNull();
    expect(ext.statusOrder).toEqual([]);
  });

  test('dev/04(a): no visualizer block -> observed statuses in FIRST-SEEN order, deduped, plus the upgrade notice', () => {
    const p = payload({
      visualizer: null,
      issues: [issue({ id: 'A', status: 'in-progress' }), issue({ id: 'B', status: 'draft' }), issue({ id: 'C', status: 'in-progress' })],
    });
    const { ext, notice } = buildEffectiveExtension(p);
    expect(ext.statusOrder).toEqual(['in-progress', 'draft']); // first-seen, not alphabetical, not re-sorted
    expect(notice).toBe(UPGRADE_NOTICE);
  });

  test('dev/04(b): a visualizerError -> notice contains the offending zod-issue text, statusOrder still falls back to observed', () => {
    const p = payload({
      visualizer: null,
      visualizerError: 'visualizer.statusOrder: Expected array, received string',
      issues: [issue({ status: 'draft' })],
    });
    const { ext, notice } = buildEffectiveExtension(p);
    expect(ext.statusOrder).toEqual(['draft']);
    expect(notice).toContain('visualizer.statusOrder');
  });

  test('a valid visualizer block drives statusOrder/acUnitLabel directly, no notice', () => {
    const p = payload({ visualizer: { statusOrder: ['draft', 'ready'], acUnitLabel: 'Dev ACs' }, issues: [] });
    const { ext, notice } = buildEffectiveExtension(p);
    expect(ext.statusOrder).toEqual(['draft', 'ready']);
    expect(ext.acUnitLabel).toBe('Dev ACs');
    expect(notice).toBeNull();
  });

  test('field-mapped assignee/pr/acText/acProof/acEvidence render from data alone (no code extension)', () => {
    const p = payload({
      preset: 'no-such-registered-preset-xyz',
      visualizer: {
        statusOrder: ['draft'], acUnitLabel: 'ACs', assignee: 'owner',
        pr: { field: 'pr', urlField: 'href' },
        acText: { id: 'acId', text: 'body', version: 'v' },
        acProof: { field: 'why', explanation: 'msg', evidenceRefs: 'refs' },
        acEvidence: { field: 'ev', image: 'img', commit: 'sha', acVersion: 'ver' },
      },
    });
    const { ext } = buildEffectiveExtension(p);

    expect(ext.assignee?.(issue({ owner: 'chris' }))).toBe('chris');
    expect(ext.pr?.(issue({ pr: { href: 'https://x/1' } }))).toEqual({ url: 'https://x/1' });

    const textHtml = renderToStaticMarkup(<>{ext.acText?.(ac({ acId: 'AC-1', body: 'Do the thing', v: 2 }))}</>);
    expect(textHtml).toContain('AC-1');
    expect(textHtml).toContain('Do the thing');
    expect(textHtml).toContain('v2');

    const proofHtml = renderToStaticMarkup(<>{ext.acProof?.(ac({ why: { msg: 'because', refs: ['E1'] } }))}</>);
    expect(proofHtml).toContain('because');
    expect(proofHtml).toContain('E1');

    const evHtml = renderToStaticMarkup(<>{ext.acEvidence?.(ac({ ev: [{ id: 'e1', img: 'shot.png', sha: 'cafefeed', ver: 3 }] }), (p2) => `/project/${p2}`)}</>);
    expect(evHtml).toContain('/project/shot.png');
    expect(evHtml).toContain('cafefeed'.slice(0, 7));
  });

  test('statusClass: identity fallback when no map is declared, mapped value when it is', () => {
    const identity = buildEffectiveExtension(payload({ visualizer: { statusOrder: ['draft'], acUnitLabel: 'ACs' } })).ext;
    expect(identity.statusClass?.('draft')).toBe('draft');

    const mapped = buildEffectiveExtension(payload({ visualizer: { statusOrder: ['draft'], acUnitLabel: 'ACs', statusClass: { draft: 'muted' } } })).ext;
    expect(mapped.statusClass?.('draft')).toBe('muted');
    expect(mapped.statusClass?.('unmapped')).toBe('unmapped'); // identity for anything not in the map
  });

  test('a code-registered extension member wins OVER the data-derived member of the same name', () => {
    registerExtension('viz4-unit-test-preset', { acText: () => 'CODE-WON' });
    const p = payload({
      preset: 'viz4-unit-test-preset',
      visualizer: { statusOrder: ['draft'], acUnitLabel: 'ACs', acText: { id: 'id', text: 'text' } },
    });
    const { ext } = buildEffectiveExtension(p);
    const html = renderToStaticMarkup(<>{ext.acText?.(ac())}</>);
    expect(html).toBe('CODE-WON');
  });

  test('issuePanels has no data equivalent — only a registered code extension supplies it', () => {
    const withoutCode = buildEffectiveExtension(payload({ preset: 'no-such-registered-preset-xyz', visualizer: { statusOrder: [], acUnitLabel: 'x' } })).ext;
    expect(withoutCode.issuePanels).toBeUndefined();

    registerExtension('viz4-unit-test-preset-panels', { issuePanels: () => 'PANEL' });
    const withCode = buildEffectiveExtension(payload({ preset: 'viz4-unit-test-preset-panels', visualizer: { statusOrder: [], acUnitLabel: 'x' } })).ext;
    expect(renderToStaticMarkup(<>{withCode.issuePanels?.(issue(), (p) => p)}</>)).toBe('PANEL');
  });

  test('operational-block policy and view label come only from the registered code extension', () => {
    registerExtension('viz4-unit-test-operational-block', {
      isOperationallyBlocked: (candidate) => candidate.status === 'human-required',
      operationalBlockLabel: () => 'awaiting owner action',
      blockedViewLabel: 'Owner action',
    });
    const blocked = issue({ status: 'human-required' });
    const { ext } = buildEffectiveExtension(payload({ preset: 'viz4-unit-test-operational-block' }));

    expect(ext.isOperationallyBlocked?.(blocked)).toBe(true);
    expect(ext.operationalBlockLabel?.(blocked)).toBe('awaiting owner action');
    expect(ext.blockedViewLabel).toBe('Owner action');
  });

  test('repeat registration merges PER MEMBER — later wins where present, other members survive (VIZ-13 layering seam)', () => {
    // The VIZ-13 scenario: a first-party extension (e.g. speckit) registers acText + issuePanels;
    // a repo extension later registers ONLY issuePanels under the same name. Per the spec's
    // pinned per-member precedence (data < first-party < repo), the repo's issuePanels must win
    // AND the first-party acText must survive — a wholesale `registry.set` would drop it.
    registerExtension('viz4-unit-test-preset-merge', { acText: () => 'FIRST-PARTY-ACTEXT', issuePanels: () => 'FIRST-PARTY-PANEL' });
    registerExtension('viz4-unit-test-preset-merge', { issuePanels: () => 'REPO-PANEL' });

    const { ext } = buildEffectiveExtension(payload({ preset: 'viz4-unit-test-preset-merge', visualizer: { statusOrder: [], acUnitLabel: 'x' } }));
    expect(renderToStaticMarkup(<>{ext.issuePanels?.(issue(), (p) => p)}</>)).toBe('REPO-PANEL'); // the later (repo) member wins
    expect(renderToStaticMarkup(<>{ext.acText?.(ac())}</>)).toBe('FIRST-PARTY-ACTEXT'); // the earlier member SURVIVES the re-registration
  });
});
