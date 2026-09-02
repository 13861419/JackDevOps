import { Injectable, Logger } from '@nestjs/common';
import { createPublicKey, createVerify } from 'node:crypto';
import type { AuthUser } from './auth.guard';

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface Jwk {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
}

@Injectable()
export class OidcService {
  readonly enabled: boolean;
  private readonly issuer: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly defaultRole: AuthUser['role'];
  private readonly roleClaim: string;
  private discovery?: OidcDiscovery;
  private jwks?: { keys: Record<string, unknown>[]; fetchedAt: number };
  private readonly states = new Map<string, number>();

  constructor() {
    this.issuer = process.env.JACK_OIDC_ISSUER ?? '';
    this.clientId = process.env.JACK_OIDC_CLIENT_ID ?? '';
    this.clientSecret = process.env.JACK_OIDC_CLIENT_SECRET ?? '';
    this.redirectUri = process.env.JACK_OIDC_REDIRECT_URI ?? '';
    this.defaultRole = (process.env.JACK_OIDC_DEFAULT_ROLE as AuthUser['role']) ?? 'admin';
    this.roleClaim = process.env.JACK_OIDC_ROLE_CLAIM ?? 'jack_role';
    this.enabled = Boolean(this.issuer && this.clientId && this.clientSecret);
  }

  async authorizeUrl(redirectUri: string, state: string): Promise<string> {
    const discovery = await this.discover();
    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid');
    url.searchParams.set('state', state);
    return url.toString();
  }

  rememberState(state: string): void {
    this.states.set(state, Date.now());
  }

  consumeState(state: string): boolean {
    const ok = this.states.delete(state);
    for (const [key, expires] of this.states) {
      if (Date.now() - expires > 600_000) {
        this.states.delete(key);
      }
    }
    return ok;
  }

  async exchangeAndVerify(code: string, redirectUri: string): Promise<{ id: string; role: AuthUser['role'] }> {
    const discovery = await this.discover();
    const res = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri || redirectUri,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!res.ok) {
      throw new Error(`token endpoint failed: ${res.status}`);
    }
    const tokens = (await res.json()) as { id_token?: string };
    if (!res.ok || !tokens.id_token) {
      throw new Error('token endpoint returned no id_token');
    }
    const payload = await this.verifyIdToken(tokens.id_token);
    const role = (payload[this.roleClaim] as AuthUser['role']) ?? this.defaultRole;
    return { id: (payload.sub as string) ?? 'oidc-user', role: role };
  }

  private async verifyIdToken(idToken: string): Promise<Record<string, unknown>> {
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new Error('malformed id_token');
    }
    const signedPart = `${parts[0]}.${parts[1]}`;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as {
      kid?: string;
      alg?: string;
    };

    const jwks = await this.loadJwks();
    const jwk = (jwks.keys ?? []).find((k) => (k as { kid?: string }).kid === header.kid) ?? jwks.keys[0];
    if (!jwk) {
      throw new Error('no matching JWK for id_token');
    }
    const signature = Buffer.from(parts[2], 'base64url');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    const valid = verifier.verify(createPublicKey({ key: jwk, format: 'jwk' }), signature);
    if (!valid) {
      throw new Error('id_token signature verification failed');
    }
    if (payload.iss !== this.issuer) {
      throw new Error(`id_token iss mismatch: ${payload.iss}`);
    }
    if (Array.isArray(payload.aud) ? !payload.aud.includes(this.clientId) : payload.aud !== this.clientId) {
      throw new Error('id_token aud mismatch');
    }
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
      throw new Error('id_token expired');
    }
    return payload;
  }

  private async discover(): Promise<OidcDiscovery> {
    if (this.discovery) {
      return this.discovery;
    }
    const res = await fetch(`${this.issuer}/.well-known/openid-configuration`);
    if (!res.ok) {
      throw new Error(`discovery failed: ${res.status}`);
    }
    this.discovery = (await res.json()) as OidcDiscovery;
    return this.discovery;
  }

  private async loadJwks(): Promise<{ keys: Record<string, unknown>[] }> {
    const discovery = await this.discover();
    if (this.jwks && Date.now() - this.jwks.fetchedAt < 600_000) {
      return this.jwks;
    }
    const res = await fetch(discovery.jwks_uri);
    if (!res.ok) {
      throw new Error(`jwks fetch failed: ${res.status}`);
    }
    this.jwks = (await res.json()) as { keys: Record<string, unknown>[]; fetchedAt: number };
    return this.jwks;
  }
}
