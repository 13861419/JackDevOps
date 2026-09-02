import { Controller, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { EventBusService } from './event-bus.service';

@Controller('events')
export class EventsStreamController {
  constructor(private readonly bus: EventBusService) {}

  @Sse('stream')
  stream(): Observable<Record<string, unknown>> {
    return new Observable<Record<string, unknown>>((observer) => {
      return this.bus.subscribe((event) => {
        observer.next({ data: event });
      });
    });
  }
}
