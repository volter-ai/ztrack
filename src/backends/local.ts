import { spawn } from 'node:child_process';
import { trackerBackendScriptPath, trackerConfigPath } from '../config.ts';
import type { TrackerBackend, TrackerBackendName, TrackerCommandResult } from '../types.ts';

function run(cmd: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; inputText?: string }): Promise<TrackerCommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    proc.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    proc.on('error', reject);
    proc.on('close', (code, signal) => {
      const result = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code === 0) {
        resolve(result);
        return;
      }
      const detail = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
      reject(new Error(detail || `${cmd} ${args.join(' ')} exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
    if (options.inputText) proc.stdin.end(options.inputText);
    else proc.stdin.end();
  });
}

export class LocalBackend implements TrackerBackend {
  readonly name = 'local' as const;
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  command(args: string[], inputText?: string): Promise<TrackerCommandResult> {
    return run('python3', [trackerBackendScriptPath(), ...args], {
      cwd: this.projectRoot,
      inputText,
      env: {
        ...process.env,
        PROJECT_ROOT: this.projectRoot,
        CONFIG_FILE: trackerConfigPath(this.projectRoot),
      },
    });
  }
}

// The tracker is always local; remote systems sync through the worlds
// egress/relay pipeline instead of acting as live backends. The name
// parameter stays for call-site stability.
export function createLocalBackend(_name: TrackerBackendName, projectRoot: string): TrackerBackend {
  return new LocalBackend(projectRoot);
}
