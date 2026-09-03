export interface ReviewPRInput {
  title: string;
  description?: string;
  files: { path: string; additions: number; deletions: number }[];
  serviceId?: string;
  diff?: string;
}

export type Severity = 'fail' | 'warn';

export interface ReviewFinding {
  rule: string;
  severity: Severity;
  message: string;
}

export type PRRule = {
  id: string;
  evaluate(pr: ReviewPRInput): ReviewFinding | null;
};

const SENSITIVE_PATH = /(^|\/)(\.env[\w.]*|secrets?)(\/|$|\.|$)|(^|\/)(deploy|infra)\//i;
const TEST_PATH = /(^|\/)(tests?|__tests__)(\/|$)|(\.(test|spec)\.[a-z]+$)/i;

export const REVIEW_RULES: PRRule[] = [
  {
    id: 'wip-title',
    evaluate: (pr) =>
      /(^|\s)(wip|draft)(:|$|\])|^\[wip\]/i.test(pr.title)
        ? { rule: 'wip-title', severity: 'warn', message: 'title indicates work-in-progress' }
        : null,
  },
  {
    id: 'large-diff',
    evaluate: (pr) => {
      const total = pr.files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
      if (total > 3000) {
        return { rule: 'large-diff', severity: 'fail', message: `diff too large (${total} lines changed, > 3000)` };
      }
      if (total > 1000) {
        return { rule: 'large-diff', severity: 'warn', message: `large diff (${total} lines changed, > 1000)` };
      }
      return null;
    },
  },
  {
    id: 'sensitive-paths',
    evaluate: (pr) => {
      const hit = pr.files.find((f) => SENSITIVE_PATH.test(f.path));
      return hit
        ? { rule: 'sensitive-paths', severity: 'fail', message: `touches sensitive path: ${hit.path}` }
        : null;
    },
  },
  {
    id: 'thin-description',
    evaluate: (pr) =>
      (pr.description ?? '').length < 20
        ? { rule: 'thin-description', severity: 'warn', message: 'description missing or too short (< 20 chars)' }
        : null,
  },
  {
    id: 'no-tests',
    evaluate: (pr) =>
      pr.files.length > 0 && !pr.files.some((f) => TEST_PATH.test(f.path))
        ? { rule: 'no-tests', severity: 'warn', message: 'no test files touched in this PR' }
        : null,
  },
];

export function runRules(pr: ReviewPRInput, rules: PRRule[] = REVIEW_RULES): {
  verdict: 'pass' | 'warn' | 'fail';
  findings: ReviewFinding[];
} {
  const findings = rules.map((r) => r.evaluate(pr)).filter((f): f is ReviewFinding => f !== null);
  const verdict = findings.some((f) => f.severity === 'fail')
    ? 'fail'
    : findings.some((f) => f.severity === 'warn')
      ? 'warn'
      : 'pass';
  return { verdict, findings };
}

export function parseDiffToFiles(diff: string): { path: string; additions: number; deletions: number }[] {
  const files = new Map<string, { additions: number; deletions: number }>();
  let current: string | null = null;
  for (const line of diff.split(/\r?\n/)) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (m) {
      current = m[2];
      if (!files.has(current)) {
        files.set(current, { additions: 0, deletions: 0 });
      }
      continue;
    }
    if (!current || line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    const entry = files.get(current);
    if (!entry) {
      continue;
    }
    if (line.startsWith('+')) {
      entry.additions += 1;
    } else if (line.startsWith('-')) {
      entry.deletions += 1;
    }
  }
  return [...files.entries()].map(([path, c]) => ({ path, ...c }));
}
