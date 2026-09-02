import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { AuthUser } from './auth.guard';

@Injectable()
export class AuthService {
  private readonly sessions = new Map<string, AuthUser>();

  issueSession(id: string, role: AuthUser['role']): { token: string; user: AuthUser } {
    const token = `oidc_${randomBytes(24).toString('hex')}`;
    const user: AuthUser = { id, role };
    this.sessions.set(token, user);
    return { token, user };
  }

  validate(token: string): AuthUser | null {
    return this.sessions.get(token) ?? null;
  }
}
