import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithTenant } from '../../events/tenant-context';
import type { AuthUser } from './auth.guard';

/**
 * Global interceptor: scopes every domain event created inside a request to
 * the authenticated user's tenant (F2 Phase 2). Events created outside an
 * HTTP request (queue workers, webhooks with system actors) stay global
 * unless the caller runs inside runWithTenant explicitly.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    return runWithTenant(request?.user?.tenantId, () => next.handle());
  }
}
