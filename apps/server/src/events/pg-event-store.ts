import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { pgTable, bigserial, varchar, integer, jsonb, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import type { DomainEvent } from './domain-event';
import type { EventStore } from './event-store';

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
  },
  (t) => [
    index('idx_domain_events_trace').on(t.traceId),
    index('idx_domain_events_aggregate').on(t.aggregateType, t.aggregateId),
    index('idx_domain_events_type').on(t.type),
  ],
);

@Injectable()
export class PgEventStore implements EventStore, OnModuleInit {
  private readonly logger = new Logger(PgEventStore.name);
  private readonly pool: Pool;
  private readonly db: NodePgDatabase<Record<string, never>>;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 5 });
    this.db = drizzle(this.pool);
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
        occurred_at VARCHAR(64) NOT NULL
      )
    `);
    await this.db.execute(sql`CREATE INDEX IF NOT EXISTS idx_domain_events_trace ON domain_events (trace_id)`);
    await this.db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_domain_events_aggregate ON domain_events (aggregate_type, aggregate_id)`,
    );
    await this.db.execute(sql`CREATE INDEX IF NOT EXISTS idx_domain_events_type ON domain_events (type)`);
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
    });
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
    };
  }

  async listByTrace(traceId: string): Promise<DomainEvent[]> {
    const rows = await this.db.select().from(domainEvents).where(sql`${domainEvents.traceId} = ${traceId}`);
    return rows.map((r) => this.mapRow(r));
  }

  async listByAggregate(aggregateType: string, aggregateId: string): Promise<DomainEvent[]> {
    const rows = await this.db
      .select()
      .from(domainEvents)
      .where(sql`${domainEvents.aggregateType} = ${aggregateType} AND ${domainEvents.aggregateId} = ${aggregateId}`);
    return rows.map((r) => this.mapRow(r));
  }

  async listByType(type: string): Promise<DomainEvent[]> {
    const rows = await this.db.select().from(domainEvents).where(sql`${domainEvents.type} = ${type}`);
    return rows.map((r) => this.mapRow(r));
  }
}
