import { createServer } from 'node:http';
import { createTrackerClient } from './sdk.ts';

export interface TrackerServerOptions {
  projectRoot?: string;
  host?: string;
  port?: number;
}

export async function serveTrackerApi(options: TrackerServerOptions = {}): Promise<void> {
  const client = createTrackerClient({ projectRoot: options.projectRoot });
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 8765;
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/graphql') {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { query?: string; variables?: Record<string, unknown> };
      const result = await client.graphql(payload.query ?? '', payload.variables);
      const body = JSON.stringify(result, null, 2);
      response.writeHead(result.errors?.length ? 500 : 200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      });
      response.end(body);
    } catch (error) {
      const body = JSON.stringify({ errors: [{ message: error instanceof Error ? error.message : String(error) }] }, null, 2);
      response.writeHead(500, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      response.end(body);
    }
  });
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.error(`tracker api listening on http://${host}:${actualPort}/graphql`);
}
