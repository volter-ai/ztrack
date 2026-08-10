import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExternalWorkActivity } from '../../src/supercode';
import type { Payload } from './model';
import { ZtrackVisualizer } from './main';

const payload: Payload = {
  title: 'Compact proof',
  preset: 'simple-sdlc',
  projectDir: '/tmp/compact-proof',
  fetchedAt: '2026-08-09T00:00:00.000Z',
  trackerChangedAt: null,
  ok: true,
  primitives: {},
  visualizer: { statusOrder: ['ready', 'in-progress', 'done'], acUnitLabel: 'ACs' },
  operationalBlocking: {},
  issues: [
    { id: 'ZT-1', title: 'Live integration work', summary: '', status: 'in-progress', acceptanceCriteria: [
      { id: 'AC-1', status: 'passed', evidence: [] },
      { id: 'AC-2', status: 'pending', evidence: [] },
    ] },
    { id: 'ZT-2', title: 'Second open issue', summary: '', status: 'ready', acceptanceCriteria: [] },
    { id: 'ZT-3', title: 'Third open issue', summary: '', status: 'ready', acceptanceCriteria: [] },
    { id: 'ZT-4', title: 'Completed issue', summary: '', status: 'done', acceptanceCriteria: [] },
  ],
  findings: [],
  audit: {},
  timestamps: {},
};

const activity: ExternalWorkActivity[] = [{
  version: 1,
  provider: 'supercode',
  sessionIdentity: 'session-live',
  sessionLabel: 'Live session',
  issueId: 'ZT-1',
  freshness: 'live',
  turnState: 'working',
  planSource: 'codex-update-plan',
  tasks: [
    { id: '1', title: 'Inspect compact contract', status: 'completed' },
    { id: '2', title: 'Render one bounded summary', status: 'in_progress' },
    { id: '3', title: 'Verify the host', status: 'pending' },
  ],
  residue: [],
  observedAt: 1786233600000,
}];

describe('compact visualizer', () => {
  test('renders one current-work summary instead of miniature board cards', () => {
    const html = renderToStaticMarkup(
      <ZtrackVisualizer payload={payload} activity={activity} variant="compact" onOpenBoard={() => undefined} />,
    );

    expect(html).toContain('Working on');
    expect(html).toContain('ZT-1');
    expect(html).toContain('Live integration work');
    expect(html).toContain('1/2 AC');
    expect(html).toContain('1/3 tasks');
    expect(html).toContain('Render one bounded summary');
    expect(html).toContain('+2 more open issues');
    expect(html).not.toContain('board-card');
    expect(html).not.toContain('Second open issue');
    expect(html.match(/compact-focus/g)).toHaveLength(1);
  });
});
