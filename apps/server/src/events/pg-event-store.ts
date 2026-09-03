import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql, and, eq } from 'drizzle-orm';
import { pgTable, bigserial, varchar, integer, jsonb, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import type { DomainEvent } from './domain-event';
import type { EventStore, ListEventsOptions } from './event-store';

const domainEvents = pgTable(
  'domain_events',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    eventId: varchar('event_id', { length: 64 }).notNull().unique(),
    traceId: varchar('trace_id', { length: 64 }).notNull(),
    type: varchar('type', { length: 128 }).notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    aggregateType: varchar('aggregate_type', { length: 32 }).notNull(),
    aggregateId: varchar('aggregate_id', { length: 64 }).notNull(),
    actorType: varchar('actor_type', { length: 16 }).notNull(),
    actorId: varchar('actor_id', { length: 64 }).notNull(),
    payload: jsonb('payload').notNull(),
    occurredAt: varchar('occurred_at', { length: 64 }).notNull(),
    aggregateVersion: integer('aggregate_version').notNull().default(1),
    tenantId: varchar('tenant_id', { length: 64 }),
  },
  (t) => [
    index('idx_domain_events_trace').on(t.traceId),
    index('idx_domain_events_aggregate').on(t.aggregateType, t.aggregateId),
    index('idx_domain_events_type').on(t.type),
    index('idx_domain_events_tenant').on(t.tenantId),
  ],
);

@Injectable()
export class PgEventStore implements EventStore, OnModuleInit {
  private readonly logger = new Logger(PgEventStore.name);
  private readonly pool: Pool;
  private readonly db: NodePgDatabase<Record<string, never>>;
  private bus?: { publish(event: DomainEvent): void };

  constructor(databaseUrl: string, bus?: { publish(event: DomainEvent): void }) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 5 });
    this.db = drizzle(this.pool);
    this.bus = bus;
  }

  async onModuleInit(): Promise<void> {
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS domain_events (
        seq BIGSERIAL PRIMARY KEY,
        event_id VARCHAR(64) NOT NULL UNIQUE,
        trace_id VARCHAR(64) NOT NULL,
        type VARCHAR(128) NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        aggregate_type VARCHAR(32) NOT NULL,
        aggregate_id VARCHAR(64) NOT NULL,
        actor_type VARCHAR(16) NOT NULL,
        actor_id VARCHAR(64) NOT NULL,
        payload JSONB NOT NULL,
        occurred_at VARCHAR(64) NOT NULL,
        aggregate_version INTEGER NOT NULL DEFAULT 1
      )
    `);
    await this.db.execute(sql`CREATE INDEX IF NOT EXISTS idx_domain_events_trace ON domain_events (trace_id)`);
    await this.db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_domain_events_aggregate ON domain_events (aggregate_type, aggregate_id)`,
    );
    await this.db.execute(sql`CREATE INDEX IF NOT EXISTS idx_domain_events_type ON domain_events (type)`);
    await this.db.execute(sql`
      ALTER TABLE domain_events ADD COLUMN IF NOT EXISTS aggregate_version INTEGER NOT NULL DEFAULT 1
    `);
    await this.db.execute(sql`
      UPDATE domain_events
      SET aggregate_version = sub.rn
      FROM (
        SELECT seq, ROW_NUMBER() OVER (PARTITION BY aggregate_type, aggregate_id ORDER BY seq) AS rn
        FROM domain_events
      ) sub
      WHERE domain_events.seq = sub.seq
    `);
    await this.db.execute(sql`
      ALTER TABLE domain_events DROP CONSTRAINT IF EXISTS uq_domain_events_aggregate_version
    `);
    await this.db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_domain_events_aggregate_version
      ON domain_events (aggregate_type, aggregate_id, aggregate_version)
    `);
    await this.db.execute(sql`
      ALTER TABLE domain_events ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64)
    `);
    await this.db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_domain_events_tenant ON domain_events (tenant_id)`,
    );
    this.logger.log('domain_events table ready');
  }

  async append(event: DomainEvent): Promise<void> {
    await this.db.insert(domainEvents).values({
      eventId: event.eventId,
      traceId: event.traceId,
      type: event.type,
      schemaVersion: event.schemaVersion,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      actorType: event.actor.type,
      actorId: event.actor.id,
      payload: event.payload,
      occurredAt: event.occurredAt,
      aggregateVersion: sql`
        (SELECT COALESCE(MAX(aggregate_version), 0) + 1 FROM domain_events
         WHERE aggregate_type = ${event.aggregateType} AND aggregate_id = ${event.aggregateId})
      `,
      tenantId: event.tenantId ?? null,
    });
    this.bus?.publish(event);
  }

  private mapRow(row: typeof domainEvents.$inferSelect): DomainEvent {
    return {
      eventId: row.eventId,
      traceId: row.traceId,
      type: row.type,
      schemaVersion: row.schemaVersion,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      actor: { type: row.actorType as DomainEvent['actor']['type'], id: row.actorId },
      payload: row.payload as DomainEvent['payload'],
      occurredAt: row.occurredAt,
      tenantId: row.tenantId ?? undefined,
    };
  }

  async listByTrace(traceId: string, opts?: ListEventsOptions): Promise<DomainEvent[]> {
    const rows = await this.db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.traceId, traceId),
          ...(opts?.tenantId ? [eq(domainEvents.tenantId, opts.tenantId)] : []),
        ),
      )
      .orderBy(domainEvents.seq);
    return rows.map((r) => this.mapRow(r));
  }

  async listByAggregate(
    aggregateType: string,
    aggregateId: string,
    opts?: ListEventsOptions,
  ): Promise<DomainEvent[]> {
    const rows = await this.db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.aggregateType, aggregateType),
          eq(domainEvents.aggregateId, aggregateId),
          ...(opts?.tenantId ? [eq(domainEvents.tenantId, opts.tenantId)] : []),
        ),
      )
      .orderBy(domainEvents.seq);
    return rows.map((r) => this.mapRow(r));
  }

  async listByType(type: string, opts?: ListEventsOptions): Promise<DomainEvent[]> {
    const rows = await this.db
      .select()
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.type, type),
          ...(opts?.tenantId ? [eq(domainEvents.tenantId, opts.tenantId)] : []),
        ),
      )
      .orderBy(domainEvents.seq);
    return rows.map((r) => this.mapRow(r));
  }

  async listAll(limit = 100, offset = 0, opts?: ListEventsOptions): Promise<DomainEvent[]> {
    const rows = await this.db
      .select()
      .from(domainEvents)
      .where(
        and(
          ...(opts?.tenantId ? [eq(domainEvents.tenantId, opts.tenantId)] : []),
        ),
      )
      .orderBy(sql`${domainEvents.seq} DESC`)
      .limit(limit)
      .offset(offset);
    return rows.map((r) => this.mapRow(r));
  }
}
