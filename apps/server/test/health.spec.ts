import { describe, expect, it } from 'vitest';
import { HealthController } from '../src/modules/health/health.controller';

describe('HealthController', () => {
  it('returns ok status', () => {
    const res = new HealthController().check();
    expect(res.status).toBe('ok');
    expect(res.service).toBe('jackdevops-server');
  });
});
