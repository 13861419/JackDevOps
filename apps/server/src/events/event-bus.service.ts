import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import Redis from 'ioredis';
import type { DomainEvent } from './domain-event';

const CHANNEL = 'jack-events';
const SEEN_CAP = 10_000;

@Injectable()
export class EventBusService implements OnModuleInit, OnModuleDestroy {
  private readonly emitter = new EventEmitter();
  private publisher?: Redis;
  private subscriber?: Redis;
  private readonly seen = new Set<string>();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  async onModuleInit(): Promise<void> {
    const redisUrl = process.env.REDIS_URL ?? process.env.JACK_REDIS_URL;
    if (!redisUrl || process.env.JACK_QUEUE_MODE === 'memory') {
      return;
    }
    const url = new URL(redisUrl);
    const options = { host: url.hostname, port: Number(url.port) || 6379, lazyConnect: false };
    this.publisher = new Redis(options);
    this.subscriber = new Redis(options);
    this.subscriber.on('message', (channel, message) => {
      if (channel !== CHANNEL) {
        return;
      }
      try {
        const event = JSON.parse(message) as DomainEvent;
        if (this.seen.has(event.eventId)) {
          return;
        }
        this.remember(event.eventId);
        this.emitter.emit('event', event);
      } catch {
        // ignore malformed payloads on the wire
      }
    });
    await this.subscriber.subscribe(CHANNEL);
  }

  async onModuleDestroy(): Promise<void> {
    await this.publisher?.quit();
    await this.subscriber?.quit();
  }

  publish(event: DomainEvent): void {
    this.emitter.emit('event', event);
    this.publisher?.publish(CHANNEL, JSON.stringify(event)).catch(() => undefined);
  }

  subscribe(listener: (event: DomainEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  private remember(eventId: string): void {
    this.seen.add(eventId);
    if (this.seen.size > SEEN_CAP) {
      const first = this.seen.values().next().value;
      if (first) {
        this.seen.delete(first);
      }
    }
  }
}
