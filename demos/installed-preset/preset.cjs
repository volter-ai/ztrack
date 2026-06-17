function sourceMarkers(body) {
  return [...new Set(String(body || '').match(/\[(?:source\s*)?\d+\]/gi) || [])];
}

function casesOf(rawSnapshot) {
  if (!rawSnapshot || typeof rawSnapshot !== 'object') return [];
  return Array.isArray(rawSnapshot.cases) ? rawSnapshot.cases : [];
}

module.exports = {
  name: 'installed-demo',

  scaffoldIssueBody(title) {
    return `# ${title}

## Summary

Source-grounded summary. [1]

## Acceptance Criteria

- [ ] dev/01 status: pending Describe one observable outcome. [1]

## Sources

[1] Requirement:
Paste the source text here.

## Evidence
`;
  },

  parseIssueMarkdown(body) {
    return {
      preset: 'installed-demo',
      acceptanceCriteria: [],
      evidence: [],
      proofs: [],
      sources: sourceMarkers(body).map((marker) => ({ number: marker.replace(/\D/g, ''), content: marker })),
    };
  },

  markdownDiagnostics(body) {
    return sourceMarkers(body).length
      ? []
      : [{ level: 'warning', code: 'installed_demo_no_source_marker', message: 'Issue body has no [N] source marker.' }];
  },

  snapshot: {
    checkSnapshot(rawSnapshot) {
      const findings = [];
      for (const issue of casesOf(rawSnapshot)) {
        const body = String(issue.body || '');
        const identifier = String(issue.identifier || issue.id || 'unknown');
        if (sourceMarkers(body).length === 0) {
          findings.push({
            level: 'error',
            code: 'installed_demo_case_missing_source_marker',
            issue: identifier,
            message: 'Installed demo preset requires each case body to cite at least one [N] source marker.',
          });
        }
      }
      const errors = findings.filter((finding) => finding.level === 'error').length;
      const warnings = findings.length - errors;
      return {
        valid: errors === 0,
        summary: {
          cases: casesOf(rawSnapshot).length,
          openCases: casesOf(rawSnapshot).filter((issue) => !['completed', 'canceled'].includes(String(issue.stateType || ''))).length,
          errors,
          warnings,
          findingCounts: Object.fromEntries([...new Set(findings.map((finding) => finding.code))].map((code) => [
            code,
            findings.filter((finding) => finding.code === code).length,
          ])),
          status: errors > 0 ? 'fail' : warnings > 0 ? 'warn' : 'pass',
        },
        findings,
      };
    },
  },
};
