import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, EVENT, AGGREGATE } from '../src/events';
import { WorkItemsService } from '../src/modules/workitems/workitems.service';
import { canTransition } from '../src/modules/workitems/workitem.types';

describe('work item state machine', () => {
  it('allows only legal transitions', () => {
    expect(canTransition('backlog', 'todo')).toBe(true);
    expect(canTransition('todo', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'done')).toBe(true);
    expect(canTransition('in_progress', 'blocked')).toBe(true);
    expect(canTransition('blocked', 'in_progress')).toBe(true);
    expect(canTransition('backlog', 'done')).toBe(false);
    expect(canTransition('done', 'todo')).toBe(false);
    expect(canTransition('todo', 'blocked')).toBe(false);
  });
});

describe('WorkItemsService (event-sourced)', () => {
  const store = new InMemoryEventStore();
  const service = new WorkItemsService(store);

  it('creates a work item in backlog with a change trace id', async () => {
    const item = await service.create({ title: '实现流水线引擎', kind: 'task', actorId: 'u1' });
    expect(item.id.startsWith('wi_')).toBe(true);
    expect(item.traceId.startsWith('chg_')).toBe(true);
    expect(item.status).toBe('backlog');
  });

  it('projects status through event replay across transitions', async () => {
    const item = await service.create({ title: '接入 Git 仓库', kind: 'task', actorId: 'u1' });
    await service.changeStatus(item.id, 'todo', 'u2');
    await service.changeStatus(item.id, 'in_progress', 'u2');
    const view = await service.changeStatus(item.id, 'done', 'u2');
    expect(view.status).toBe('done');
  });

  it('rejects illegal transitions without emitting events', async () => {
    const item = await service.create({ title: '修复构建', kind: 'bug', actorId: 'u1' });
    await expect(service.changeStatus(item.id, 'done', 'u1')).rejects.toThrow();
    const trace = await service.trace(item.id);
    expect(trace).toHaveLength(1);
    expect(trace[0].type).toBe(EVENT.workItemCreated);
  });

  it('keeps one change trace across the full lifecycle (F1 变更指纹)', async () => {
    const item = await service.create({ title: '需求:服务目录', kind: 'requirement', actorId: 'pm' });
    await service.changeStatus(item.id, 'todo', 'dev');
    const trace = await service.trace(item.id);
    const traceIds = new Set(trace.map((e) => e.traceId));
    expect(traceIds.size).toBe(1);
    expect(traceIds.has(item.traceId)).toBe(true);
    expect(trace.map((e) => e.type)).toEqual([EVENT.workItemCreated, EVENT.workItemStatusChanged]);
    expect(trace.every((e) => e.aggregateType === AGGREGATE.workItem)).toBe(true);
  });
});
