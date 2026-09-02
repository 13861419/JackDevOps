#!/usr/bin/env node
// Minimal local OIDC provider for testing the JackDevOps SSO flow.
// Usage: node scripts/fake-oidp.mjs [port=4545]
import { createServer } from 'node:http';
import { generateKeyPairSync, createSign, createHash } from 'node:crypto';

const PORT = Number(process.env.OIDP_PORT ?? 4545);
const ISSUER = `http://localhost:${PORT}`;
const CLIENT_ID = process.env.JACK_OIDC_CLIENT_ID ?? 'jack-dev';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fake-key', alg: 'RS256', use: 'sig' };
const codes = new Set();

function signIdToken(aud) {
  const header = { alg: 'RS256', kid: 'fake-key' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: ISSUER,
    sub: 'oidc-user-1',
    aud,
    exp: now + 600,
    iat: now,
    jack_role: 'admin',
  };
  const signed = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signed);
  signer.end();
  return `${signed}.${signer.sign(privateKey).toString('base64url')}`;
}

createServer((req, res) => {
  const url = new URL(req.url, ISSUER);

  if (url.pathname === '/.well-known/openid-configuration') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
      }),
    );
    return;
  }

  if (url.pathname === '/jwks') {
    const jwkPublic = { ...jwk };
    delete jwkPublic.use;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwkPublic] }));
    return;
  }

  if (url.pathname === '/authorize') {
    const code = createHash('sha256').update(`${Date.now()}${Math.random()}`).digest('hex').slice(0, 24);
    codes.add(code);
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    if (url.searchParams.get('state')) {
      target.searchParams.set('state', url.searchParams.get('state'));
    }
    res.writeHead(302, { location: target.toString() });
    res.end();
    return;
  }

  if (url.pathname === '/token' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const params = new URLSearchParams(body);
      if (!codes.has(params.get('code'))) {
        res.writeHead(400).end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }
      codes.delete(params.get('code'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          access_token: 'fake-access-token',
          token_type: 'Bearer',
          id_token: signIdToken(params.get('client_id')),
        }),
      );
    });
    return;
  }

  res.writeHead(404).end('not found');
}).listen(PORT, () => console.log(`fake OIDP on ${ISSUER} | client_id: ${CLIENT_ID}`));
