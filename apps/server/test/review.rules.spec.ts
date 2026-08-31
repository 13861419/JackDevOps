import { describe, expect, it } from 'vitest';
import { runRules, type ReviewPRInput } from '../src/modules/review/review.rules';

const base: ReviewPRInput = {
  title: 'feat: add refund endpoint',
  description: 'Adds refund endpoint with validation and unit tests covering edge cases.',
  files: [
    { path: 'src/refund.ts', additions: 80, deletions: 10 },
    { path: 'tests/refund.spec.ts', additions: 40, deletions: 0 },
  ],
};

describe('PR review rules (B2)', () => {
  it('passes a clean PR', () => {
    expect(runRules(base).verdict).toBe('pass');
  });

  it('warns on thin description', () => {
    const { verdict, findings } = runRules({ ...base, description: 'x' });
    expect(verdict).toBe('warn');
    expect(findings.some((f) => f.rule === 'thin-description')).toBe(true);
  });

  it('fails on sensitive paths', () => {
    const { verdict, findings } = runRules({
      ...base,
      files: [...base.files, { path: 'deploy/secret.yaml', additions: 5, deletions: 0 }],
    });
    expect(verdict).toBe('fail');
    expect(findings.some((f) => f.rule === 'sensitive-paths')).toBe(true);
  });

  it('fails on very large diffs', () => {
    const { verdict, findings } = runRules({
      ...base,
      files: [{ path: 'src/big.ts', additions: 2000, deletions: 1200 }],
    });
    expect(verdict).toBe('fail');
    expect(findings.some((f) => f.rule === 'large-diff')).toBe(true);
  });

  it('warns when no test files are touched', () => {
    const { verdict, findings } = runRules({
      ...base,
      files: [{ path: 'src/refund.ts', additions: 10, deletions: 0 }],
    });
    expect(verdict).toBe('warn');
    expect(findings.some((f) => f.rule === 'no-tests')).toBe(true);
  });
});
