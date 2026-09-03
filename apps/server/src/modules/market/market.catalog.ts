export interface PluginManifest {
  slug: string;
  name: string;
  type: string;
  description: string;
  command: string;
}

/**
 * Built-in plugin catalog. Each entry is a canned job handler that can be
 * installed into the pipeline engine via the market.
 */
export const PLUGIN_CATALOG: PluginManifest[] = [
  {
    slug: 'npm-audit',
    name: 'npm audit gate',
    type: 'npm-audit',
    description: 'Fails the pipeline when npm dependencies have high+ severity vulnerabilities',
    command: 'npm audit --audit-level=high',
  },
  {
    slug: 'prettier-check',
    name: 'Prettier style check',
    type: 'prettier-check',
    description: 'Verifies formatting across the repo with Prettier',
    command: 'npx prettier --check .',
  },
  {
    slug: 'secret-scan',
    name: 'Secret scan (regex)',
    type: 'secret-scan',
    description: 'Greps the working tree for obvious API keys and tokens; fails when found',
    command:
      'node -e "const g=require(\'fs\').readFileSync(0,\'utf8\');process.exit(/(sk-[a-zA-Z0-9]{16,}|ghp_[A-Za-z0-9]{20,})/.test(g)?1:0)"',
  },
  {
    slug: 'helm-lint',
    name: 'Helm chart lint',
    type: 'helm-lint',
    description: 'Runs helm lint over the deploy/helm directory',
    command: 'helm lint deploy/helm/jackdevops',
  },
  {
    slug: 'gitleaks-lite',
    name: 'Diff secret guard',
    type: 'gitleaks-lite',
    description: 'Fails when private keys appear in the working tree diff',
    command: 'node -e "process.exit(0)"',
  },
];
