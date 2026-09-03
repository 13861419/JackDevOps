import { ConflictException, Inject, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { AGGREGATE, EVENT, makeEvent } from '../../events';
import { EVENT_STORE, type EventStore } from '../../events';
import { JobRegistry } from '../workflows/job-registry';
import type { JobHandler, JobType } from '../workflows/workflow.types';
import { PLUGIN_CATALOG, type PluginManifest } from './market.catalog';

const execAsync = promisify(exec);

@Injectable()
export class MarketService implements OnModuleInit {
  private readonly installed = new Map<string, PluginManifest>();

  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    private readonly registry: JobRegistry,
    @Optional() private readonly execImpl?: (
      command: string,
      opts: { timeout: number; cwd?: string },
    ) => Promise<{ stdout: string; stderr: string }>,
  ) {
    this.execImpl = execImpl ?? ((command, opts) => execAsync(command, opts));
  }

  async onModuleInit(): Promise<void> {
    const installed = await this.eventStore
      .listByType(EVENT.marketPluginInstalled)
      .then((events) => events.map((e) => e.payload.slug as string));
    for (const slug of installed) {
      await this.registerPlugin(slug);
    }
  }

  list(): (PluginManifest & { installed: boolean })[] {
    return PLUGIN_CATALOG.map((m) => ({ ...m, installed: this.installed.has(m.slug) }));
  }

  listInstalled(): PluginManifest[] {
    return [...this.installed.values()];
  }

  async install(slug: string, actorId: string): Promise<PluginManifest> {
    if (this.installed.has(slug)) {
      throw new ConflictException(`plugin '${slug}' is already installed`);
    }
    const manifest = await this.registerPlugin(slug);
    await this.eventStore.append(
      makeEvent({
        traceId: `${slug}-${Date.now().toString(36)}`,
        type: EVENT.marketPluginInstalled,
        aggregateType: AGGREGATE.plugin,
        aggregateId: slug,
        actor: { type: 'user', id: actorId },
        payload: { slug, type: manifest.type, version: 1 },
      }),
    );
    return manifest;
  }

  async uninstall(slug: string, actorId: string): Promise<void> {
    if (!this.installed.has(slug)) {
      throw new NotFoundException(`plugin '${slug}' is not installed`);
    }
    const manifest = this.installed.get(slug) as PluginManifest;
    this.installed.delete(slug);
    this.registry.unregister(manifest.type);
    await this.eventStore.append(
      makeEvent({
        traceId: `plug-un-${Date.now().toString(36)}`,
        type: EVENT.marketPluginUninstalled,
        aggregateType: AGGREGATE.plugin,
        aggregateId: slug,
        actor: { type: 'user', id: actorId },
        payload: { slug },
      }),
    );
  }

  private async registerPlugin(slug: string): Promise<PluginManifest> {
    const manifest = PLUGIN_CATALOG.find((m) => m.slug === slug);
    if (!manifest) {
      throw new NotFoundException(`plugin '${slug}' not found in catalog`);
    }
    const handler = this.buildHandler(manifest);
    this.registry.register(handler);
    this.installed.set(slug, manifest);
    return manifest;
  }

  buildHandler(manifest: PluginManifest): JobHandler {
    const exec = this.execImpl as NonNullable<typeof this.execImpl>;
    const handler: JobHandler = {
      type: manifest.type,
      description: manifest.description,
      run: async (ctx) => {
        const started = Date.now();
        const timeoutMs = Number(ctx.config?.timeoutMs) || 120_000;
        const cwd = typeof ctx.config?.cwd === 'string' ? ctx.config.cwd : undefined;
        let stdout = '';
        try {
          const res = await exec(manifest.command, { timeout: timeoutMs, cwd });
          stdout = (res.stdout || res.stderr || '').slice(0, 2000);
        } catch (err) {
          const e = err as { code?: number | string; stdout?: string; stderr?: string; message?: string };
          throw new Error(
            `plugin '${manifest.slug}' failed (code ${e.code ?? '?'}): ${(e.stderr || e.stdout || e.message || '').slice(0, 200)}`,
          );
        }
        return { ok: true, type: manifest.type, executed: true, durationMs: Date.now() - started, stdout };
      },
    };
    return handler;
  }
}

export type { JobType };
