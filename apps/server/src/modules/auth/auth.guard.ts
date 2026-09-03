import { ForbiddenException, Injectable } from '@nestjs/common';
import { CanActivate, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';

export interface AuthUser {
  id: string;
  role: 'admin' | 'pm' | 'dev' | 'qa' | 'ops';
  tenantId?: string;
}

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: AuthUser['role'][]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

interface HttpRequest {
  headers: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  user?: AuthUser;
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly users = new Map<string, AuthUser>();

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: AuthService,
  ) {
    const adminToken = process.env.JACK_ADMIN_TOKEN ?? 'dev-admin-token';
    this.users.set(adminToken, { id: 'admin', role: 'admin', tenantId: 'default' });
    const extra = process.env.JACK_USERS;
    if (extra) {
      try {
        const parsed = JSON.parse(extra) as Record<string, { id: string; role: AuthUser['role']; tenantId?: string }>;
        for (const [token, user] of Object.entries(parsed)) {
          this.users.set(token, { tenantId: 'default', ...user });
        }
      } catch {
        console.warn('[auth] JACK_USERS is not valid JSON, ignoring extra users');
      }
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const header = request.headers.authorization ?? '';
    const queryToken = request.query?.token;
    const token = header.startsWith('Bearer ')
      ? header.slice(7)
      : typeof queryToken === 'string'
        ? queryToken
        : null;
    const user =
      (token ? this.users.get(token) : undefined) ?? (token ? this.sessions.validate(token) : undefined);
    if (!user) {
      throw new ForbiddenException('missing or invalid bearer token');
    }
    request.user = user;
    const required = this.reflector.getAllAndOverride<AuthUser['role'][] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && !required.includes(user.role)) {
      throw new ForbiddenException(`role '${user.role}' is not allowed for this operation`);
    }
    return true;
  }
}
