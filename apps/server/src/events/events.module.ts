import { Global, Module } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { InMemoryEventStore } from './event-store';
import { PgEventStore } from './pg-event-store';
import { EventBusService } from './event-bus.service';
import { EventsStreamController } from './events-stream.controller';

export const EVENT_STORE = 'EVENT_STORE';

@Global()
@Module({
  controllers: [EventsStreamController],
  providers: [
    EventBusService,
    {
      provide: EVENT_STORE,
      useFactory: (bus: EventBusService) => {
        if (process.env.DATABASE_URL) {
          return new PgEventStore(process.env.DATABASE_URL, bus);
        }
        return new InMemoryEventStore(bus);
      },
      inject: [EventBusService],
    },
  ],
  exports: [EVENT_STORE, EventBusService],
})
export class EventsModule {
  private readonly logger = new Logger(EventsModule.name);

  constructor() {
    if (!process.env.DATABASE_URL) {
      this.logger.warn('DATABASE_URL not set: using InMemoryEventStore (data is not persisted)');
    }
  }
}
