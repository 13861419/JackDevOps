import { Controller, Get, NotFoundException, Req, Res } from '@nestjs/common';
import { OidcService } from './oidc.service';
import { AuthService } from './auth.service';
import { Public } from './auth.guard';

interface RequestLike {
  url?: string;
  protocol?: string;
  headers: Record<string, unknown>;
}

interface ResponseLike {
  redirect(status: number, url: string): unknown;
  status(code: number): { json(body: unknown): void };
  json(body: unknown): void;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly oidc: OidcService,
    private readonly auth: AuthService,
  ) {}

  @Get('oidc/status')
  @Public()
  status(): { enabled: boolean } {
    return { enabled: this.oidc.enabled };
  }

  @Get('oidc/start')
  @Public()
  async start(@Req() req: RequestLike, @Res() res: ResponseLike): Promise<void> {
    if (!this.oidc.enabled) {
      throw new NotFoundException('OIDC not configured');
    }
    const state = `st_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    this.oidc.rememberState(state);
    const redirectUri = this.callbackUrl(req);
    const url = await this.oidc.authorizeUrl(redirectUri, state);
    res.redirect(302, url);
  }

  @Get('oidc/callback')
  @Public()
  async callback(@Req() req: RequestLike, @Res() res: ResponseLike): Promise<void> {
    if (!this.oidc.enabled) {
      throw new NotFoundException('OIDC not configured');
    }
    const url = new URL(req.url ?? '/auth/oidc/callback', `http://${String(req.headers.host ?? 'localhost')}`);
    const code = url.searchParams.get('code') ?? '';
    const state = url.searchParams.get('state') ?? '';
    if (!code || !this.oidc.consumeState(state)) {
      res.status(400).json({ message: 'invalid state or code' });
      return;
    }
    const session = await this.oidc.exchangeAndVerify(code, this.callbackUrl(req));
    const issued = this.auth.issueSession(session.id, session.role);
    const webUrl = process.env.JACK_OIDC_WEB_URL;
    if (webUrl) {
      res.redirect(302, `${webUrl}#/auth?token=${encodeURIComponent(issued.token)}`);
      return;
    }
    res.json({ token: issued.token, user: issued.user });
  }

  private callbackUrl(req: RequestLike): string {
    if (process.env.JACK_OIDC_REDIRECT_URI) {
      return process.env.JACK_OIDC_REDIRECT_URI;
    }
    const proto = (req.headers['x-forwarded-proto'] as string) ?? req.protocol ?? 'http';
    const host = String(req.headers.host ?? 'localhost:3000');
    return `${proto}://${host}/auth/oidc/callback`;
  }
}
