import { exec, spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { JobHandler, JobType } from './workflow.types';

const execAsync = promisify(exec);
const OUTPUT_LIMIT = 8192;
const DEFAULT_TIMEOUT_MS = 600_000;

function clip(text: string | undefined, limit = OUTPUT_LIMIT): string {
  if (!text) {
    return '';
  }
  return text.length <= limit ? text : `${text.slice(0, limit)}...[truncated ${text.length - limit} chars]`;
}

type ShellResult = {
  ok: true;
  type: JobType;
  executed: boolean;
  durationMs: number;
  stdout?: string;
  stderr?: string;
};

async function runShell(
  type: JobType,
  command: string,
  config: Record<string, unknown>,
): Promise<ShellResult> {
  const started = Date.now();
  const timeoutMs = Number(config.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const cwd = typeof config.cwd === 'string' ? config.cwd : undefined;
  try {
    const res = await execAsync(command, { timeout: timeoutMs, cwd, windowsHide: true });
    return {
      ok: true,
      type,
      executed: true,
      durationMs: Date.now() - started,
      stdout: clip(res.stdout),
      stderr: clip(res.stderr),
    };
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string; message?: string };
    const tail = clip(e.stderr || e.stdout, 500);
    throw new Error(`command failed (code ${e.code ?? '?'}): ${tail || e.message}`);
  }
}

@Injectable()
export class JobRegistry {
  private readonly handlers = new Map<JobType, JobHandler>();

  constructor() {
    for (const handler of builtinHandlers()) {
      this.register(handler);
    }
  }

  register(handler: JobHandler): void {
    this.handlers.set(handler.type, handler);
  }

  get(type: JobType): JobHandler {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new BadRequestException(`no handler registered for job type '${type}'`);
    }
    return handler;
  }

  has(type: JobType): boolean {
    return this.handlers.has(type);
  }

  types(): JobType[] {
    return [...this.handlers.keys()];
  }
}

function shellBuiltin(type: JobType, description: string): JobHandler {
  return {
    type,
    description,
    run: async (ctx) => {
      const command = typeof ctx.config.command === 'string' ? ctx.config.command : '';
      if (!command) {
        return { ok: true, type, executed: false, durationMs: 0, note: 'no command configured; stub pass' };
      }
      return runShell(type, command, ctx.config);
    },
  };
}

export async function hasBinary(binary: string): Promise<boolean> {
  try {
    await execAsync(`${binary} --version`, { timeout: 10_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export function runDshAgent(
  task: string,
  cwd: string | undefined,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let dshBin: string;
    try {
      dshBin = require.resolve('@deepseek-ai/dsh/lib/bin.js');
    } catch {
      reject(new Error('@deepseek-ai/dsh not installed; agent skipped (graceful)'));
      return;
    }
    const child = spawn(process.execPath, [dshBin, '--profile', 'headless', task], {
      cwd,
      env: process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`dsh agent failed (code ${code ?? '?'}): ${clip(stderr || stdout, 500)}`));
      }
    });
  });
}

function builtinHandlers(): JobHandler[] {
  return [
    {
      type: 'scan',
      description: 'Trivy image/fs scan gate; falls back to config.command, then stub pass',
      run: async (ctx) => {
        if (ctx.config.trivy === true) {
          const target = typeof ctx.config.path === 'string' ? ctx.config.path : '.';
          const available = await hasBinary('trivy');
          if (!available) {
            throw new Error('trivy binary not found on PATH (C3 gate is fail-closed)');
          }
          return runShell('scan', `trivy fs --quiet ${JSON.stringify(target)}`, ctx.config);
        }
        return shellBuiltin('scan', 'scan gate').run(ctx);
      },
    },
    shellBuiltin('build', 'Build artifact'),
    shellBuiltin('test', 'Run test suites'),
    shellBuiltin('deploy', 'Deploy to environment'),
    {
      type: 'container-build',
      description: 'Docker build (and optional push); gracefully skips when docker is unavailable',
      run: async (ctx) => {
        const image = typeof ctx.config.image === 'string' ? ctx.config.image : '';
        if (!image) {
          return { ok: true, type: 'container-build', executed: false, durationMs: 0, note: 'no image configured; stub pass' };
        }
        if (!(await hasBinary('docker'))) {
          return {
            ok: true,
            type: 'container-build',
            executed: false,
            durationMs: 0,
            note: `docker not available; would build ${image} (graceful skip)`,
          };
        }
        const dockerfile = typeof ctx.config.dockerfile === 'string' ? ctx.config.dockerfile : 'Dockerfile';
        const context = typeof ctx.config.context === 'string' ? ctx.config.context : '.';
        const dockerfileArg = isAbsolute(dockerfile) ? dockerfile : `${context}/${dockerfile}`;
        const tag = typeof ctx.config.tag === 'string' ? ctx.config.tag : 'latest';
        const started = Date.now();
        await runShell('container-build', `docker build -f ${dockerfileArg} -t ${image}:${tag} ${context}`, ctx.config);
        if (ctx.config.push === true) {
          await runShell('container-build', `docker push ${image}:${tag}`, ctx.config);
        }
        return {
          ok: true,
          type: 'container-build',
          executed: true,
          durationMs: Date.now() - started,
          stdout: `built ${image}:${tag}${ctx.config.push === true ? ' and pushed' : ''}`,
        };
      },
    },
    {
      type: 'agent',
      description: 'DeepSeek Harness (dsh) headless agent run; requires config.task + DEEPSEEK_API_KEY',
      run: async (ctx) => {
        const task = typeof ctx.config.task === 'string' ? ctx.config.task : '';
        if (!task) {
          return { ok: true, type: 'agent', executed: false, durationMs: 0, note: 'no task configured; stub pass' };
        }
        if (!process.env.DEEPSEEK_API_KEY) {
          return {
            ok: true,
            type: 'agent',
            executed: false,
            durationMs: 0,
            note: 'DEEPSEEK_API_KEY not set; dsh agent skipped (graceful)',
          };
        }
        const started = Date.now();
        const timeoutMs = Number(ctx.config.timeoutMs) || 900_000;
        try {
          const result = await runDshAgent(task, typeof ctx.config.cwd === 'string' ? ctx.config.cwd : undefined, timeoutMs);
          return {
            ok: true,
            type: 'agent',
            executed: true,
            durationMs: Date.now() - started,
            stdout: clip(result.stdout),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes('not installed')) {
            return { ok: true, type: 'agent', executed: false, durationMs: 0, note: message };
          }
          throw new Error(`dsh agent failed: ${message.slice(0, 500)}`);
        }
      },
    },
  ];
}
