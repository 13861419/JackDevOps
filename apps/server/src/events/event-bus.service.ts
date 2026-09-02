import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { DomainEvent } from './domain-event';

@Injectable()
export class EventBusService {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(event: DomainEvent): void {
    this.emitter.emit('event', event);
  }

  subscribe(listener: (event: DomainEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}
