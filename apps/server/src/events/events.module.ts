import { Global, Module } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { InMemoryEventStore } from './event-store';
import { PgEventStore } from './pg-event-store';

export const EVENT_STORE = 'EVENT_STORE';

@Global()
@Module({
  providers: [
    {
      provide: EVENT_STORE,
      useFactory: () => {
        if (process.env.DATABASE_URL) {
          return new PgEventStore(process.env.DATABASE_URL);
        }
        return new InMemoryEventStore();
      },
      inject: [],
    },
  ],
  exports: [EVENT_STORE],
})
export class EventsModule {
  private readonly logger = new Logger(EventsModule.name);

  constructor() {
    if (!process.env.DATABASE_URL) {
      this.logger.warn('DATABASE_URL not set: using InMemoryEventStore (data is not persisted)');
    }
  }
}
