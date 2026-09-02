import { RunExecutor } from '../src/modules/runqueue/run-executor.service';
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '../src/events';
import { JobRegistry } from '../src/modules/workflows/job-registry';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { TemplatesService } from '../src/modules/templates/templates.service';
import { OnboardingService } from '../src/modules/onboarding/onboarding.service';
import { buildPayload, formatRunCompleted } from '../src/modules/notify/notify.payloads';

describe('onboarding quickstart (D7)', () => {
  const store = new InMemoryEventStore();
  const catalog = new CatalogService(store);
  const workflows = new WorkflowsService(store, new JobRegistry());
  const templates = new TemplatesService(store, workflows);
  const onboarding = new OnboardingService(catalog, templates);

  it('registers a service and instantiates the language template in one call', async () => {
    await templates.onModuleInit();
    const result = await onboarding.quickstart({
      name: 'inventory-api',
      language: 'go',
      ownerId: 'u1',
    });
    expect(result.service.slug).toBe('inventory-api');
    expect(result.workflow).not.toBeNull();
    expect(result.workflow?.spec.jobs.length).toBe(4);
    expect(result.guide.webhookUrl).toBe('/webhooks/git/inventory-api');
    expect(result.guide.nextSteps.length).toBe(3);
  });

  it('derives a unique slug when the requested one is taken', async () => {
    const a = await onboarding.quickstart({ name: 'dup-svc', language: 'node', ownerId: 'u1' });
    const b = await onboarding.quickstart({ name: 'dup-svc', language: 'go', ownerId: 'u1' });
    expect(b.service.slug).not.toBe(a.service.slug);
    expect(b.service.slug.startsWith('dup-svc-')).toBe(true);
  });

  it('falls back to generated slug for non-ascii names', async () => {
    const result = await onboarding.quickstart({ name: '库存服务', language: 'node', ownerId: 'u1' });
    expect(result.service.slug.startsWith('svc-')).toBe(true);
  });
});

describe('IM notification payloads (A4)', () => {
  it('builds provider-specific payloads', () => {
    expect(formatRunCompleted({ workflowName: 'cd', status: 'succeeded', commit: 'abc' })).toContain(
      'cd',
    );
    expect(buildPayload('slack', 'hi')).toEqual({ text: 'hi' });
    expect(buildPayload('dingtalk', 'hi')).toEqual({ msgtype: 'text', text: { content: 'hi' } });
    expect(buildPayload('feishu', 'hi')).toEqual({ msg_type: 'text', content: { text: 'hi' } });
    expect(buildPayload('wecom', 'hi')).toEqual({ msgtype: 'text', text: { content: 'hi' } });
  });
});
