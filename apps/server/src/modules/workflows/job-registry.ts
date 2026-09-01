import { exec } from 'node:child_process';
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
        const tag = typeof ctx.config.tag === 'string' ? ctx.config.tag : 'latest';
        const started = Date.now();
        await runShell('container-build', `docker build -f ${dockerfile} -t ${image}:${tag} ${context}`, ctx.config);
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
      description: 'AI agent session via dsh (activates in Phase 2)',
      run: async () => {
        throw new BadRequestException('agent jobs activate in Phase 2 (dsh integration)');
      },
    },
  ];
}
