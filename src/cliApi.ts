// ZTB-31 dev/02: `ztrack api query|serve` — extracted verbatim from cli.ts (the last inline
// multi-branch command), following the established verb-module pattern (cliCheck.ts/cliFmt.ts/
// cliLint.ts/...): flag parsing + dispatch only, called from cli.ts's main(). The only deltas
// from the inline version are precedented by ZTB-28: a per-handler `createTrackerClient()`
// (cli.ts's own `client` is still needed below this dispatch point for `issue edit`/the generic
// backend fallthrough, so it isn't shared) and `return;` -> `return true;`.
import { optionValue } from './cliArgs.ts';
import { commandName } from './cliHelp.ts';
import { createTrackerClient } from './sdk.ts';
import { serveTrackerApi } from './server.ts';

/** `ztrack api query --query '...'` | `ztrack api serve [--host] [--port]`. Returns true once handled. */
export async function handleApiCommand(args: string[]): Promise<boolean> {
  if (args[0] !== 'api') return false;
  const command = commandName();
  const client = createTrackerClient();
  const action = args[1];
  if (!action || action === '--help' || action === '-h' || action === 'help') {
    process.stdout.write(`Usage: ${command} api <query|serve> [args...]

GraphQL-shaped query against the local tracker store.

  ${command} api query --query '{ issues(first: 10) { nodes { identifier title } } }'
  ${command} api serve --host 127.0.0.1 --port 8765
`);
    return true;
  }
  if (action === 'query') {
    const query = optionValue(args, '--query');
    if (!query) throw new Error('tracker api query: --query required');
    process.stdout.write(`${JSON.stringify(await client.graphql(query), null, 2)}\n`);
    return true;
  }
  if (action === 'serve') {
    await serveTrackerApi({
      host: optionValue(args, '--host', '127.0.0.1'),
      port: Number(optionValue(args, '--port', '8765')),
    });
    return true;
  }
  throw new Error(`tracker api: unknown action '${action ?? ''}'`);
}
