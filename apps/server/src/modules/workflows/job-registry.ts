import { BadRequestException, Injectable } from '@nestjs/common';
import type { JobHandler, JobType } from './workflow.types';

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

function stub(type: JobType, description: string): JobHandler {
  return {
    type,
    description,
    run: async () => ({ ok: true, type }),
  };
}

function builtinHandlers(): JobHandler[] {
  return [
    stub('scan', 'Trivy image scan gate (stub until M3)'),
    stub('build', 'Build artifact (stub until M3)'),
    stub('test', 'Run test suites (stub until M3)'),
    stub('deploy', 'Deploy to environment (stub until M3)'),
    {
      type: 'agent',
      description: 'AI agent session via dsh (activates in Phase 2)',
      run: async () => {
        throw new BadRequestException('agent jobs activate in Phase 2 (dsh integration)');
      },
    },
  ];
}
