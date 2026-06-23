import { describe, expect, test } from 'bun:test';
import { ghApiArgs, parseGhResponse, ghExecute, type GhRun } from './githubExecute.ts';

describe('gh-backed GithubExecute', () => {
  test('GET: path templates substitute; other params become a query string', () => {
    const { args, input } = ghApiArgs('GET /repos/{owner}/{repo}/issues', { owner: 'o', repo: 'r', per_page: 100, state: 'all' });
    expect(args).toEqual(['api', '--include', '-X', 'GET', 'repos/o/r/issues?per_page=100&state=all']);
    expect(input).toBeUndefined();
  });

  test('write: non-path params become a JSON body via --input', () => {
    const { args, input } = ghApiArgs('PATCH /repos/{owner}/{repo}/issues/{n}', { owner: 'o', repo: 'r', n: 5, title: 'T', state: 'closed' });
    expect(args).toEqual(['api', '--include', '-X', 'PATCH', 'repos/o/r/issues/5', '--input', '-']);
    expect(JSON.parse(input!)).toEqual({ title: 'T', state: 'closed' });
  });

  test('parseGhResponse: status from the HTTP line; body after the blank line', () => {
    const ok = parseGhResponse('HTTP/2.0 200 OK\r\nx-foo: bar\r\n\r\n{"name":"hello"}', true);
    expect(ok).toEqual({ status: 200, data: { name: 'hello' } });
    const notFound = parseGhResponse('HTTP/2.0 404 Not Found\r\n\r\n{"message":"Not Found"}', false);
    expect(notFound.status).toBe(404);
  });

  test('ghExecute routes through the injected runner and returns {status,data}', async () => {
    const fake: GhRun = (args) => ({ status: 0, stdout: 'HTTP/2.0 201 Created\r\n\r\n{"number":7}', stderr: '' });
    const res = await ghExecute(fake).request('POST /repos/{owner}/{repo}/issues', { owner: 'o', repo: 'r', title: 'x' });
    expect(res).toEqual({ status: 201, data: { number: 7 } });
  });

  // Real read against GitHub through the authenticated gh CLI (no token in the test).
  test('integration: real gh read of a public repo', async () => {
    const res = await ghExecute().request('GET /repos/{owner}/{repo}', { owner: 'octocat', repo: 'Hello-World' });
    expect(res.status).toBe(200);
    expect((res.data as { name?: string }).name).toBe('Hello-World');
  });
});
