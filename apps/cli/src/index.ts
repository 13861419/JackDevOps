#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.jackdevops');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface Config {
  server: string;
  token: string;
}

function loadConfig(): Config {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as Partial<Config>;
    return {
      server: process.env.JACK_SERVER ?? parsed.server ?? 'http://localhost:3000',
      token: process.env.JACK_TOKEN ?? parsed.token ?? 'dev-admin-token',
    };
  } catch {
    return {
      server: process.env.JACK_SERVER ?? 'http://localhost:3000',
      token: process.env.JACK_TOKEN ?? 'dev-admin-token',
    };
  }
}

function saveConfig(config: Config): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function api<T = unknown>(config: Config, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${config.server}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      out[argv[i].slice(2)] = argv[i + 1] ?? '';
      i++;
    }
  }
  return out;
}

const HELP = `JackDevOps CLI

Usage: jack <command> [args] [--server url] [--token token]

Commands:
  login <token> [--server <url>]   Save server URL and token
  quickstart --name <n> [--language node|go|python]
                                   One-step service + pipeline setup
  items list                       List work items
  items create --title <t> [--kind task|requirement|bug]
  items move <id> --to <status>    Move work item status
  workflows list                   List workflows
  workflows run <workflowId>       Run a workflow
  runs <runId>                     Show run status and event trace
`;

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  const config = loadConfig();
  const flags = parseFlags(rest);
  const positional = rest.filter((a) => !a.startsWith('--') && !(a === '--' ));

  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(HELP);
    return;
  }

  switch (cmd) {
    case 'login': {
      const token = rest[0];
      if (!token) {
        throw new Error('usage: jack login <token> [--server <url>]');
      }
      saveConfig({ server: flags.server ?? config.server, token });
      console.log(`logged in -> ${flags.server ?? config.server}`);
      return;
    }
    case 'quickstart': {
      const res = await api<{
        service: { slug: string };
        workflow: { id: string } | null;
        guide: { webhookUrl: string };
      }>(config, 'POST', '/onboarding/quickstart', {
        name: flags.name ?? '',
        language: flags.language ?? 'node',
        ownerId: flags.owner ?? 'cli',
        slug: flags.slug,
      });
      console.log(`service:  ${res.service.slug}`);
      console.log(`workflow: ${res.workflow?.id ?? '(none)'}`);
      console.log(`webhook:  ${config.server}${res.guide.webhookUrl}`);
      return;
    }
    case 'items': {
      if (sub() === 'create') {
        const item = await api(config, 'POST', '/work-items', {
          title: flags.title ?? '',
          kind: flags.kind ?? 'task',
          actorId: 'cli',
        });
        console.log(JSON.stringify(item, null, 2));
        return;
      }
      if (sub() === 'move') {
        const id = positional[1];
        const item = await api(config, 'POST', `/work-items/${id}/status`, {
          to: flags.to ?? '',
          actorId: 'cli',
        });
        console.log(JSON.stringify(item, null, 2));
        return;
      }
      const items = await api(config, 'GET', '/work-items');
      console.log(JSON.stringify(items, null, 2));
      return;
    }
    case 'workflows': {
      if (sub() === 'run') {
        const run = await api(config, 'POST', `/workflows/${positional[1]}/runs`);
        console.log(JSON.stringify(run, null, 2));
        return;
      }
      const list = await api(config, 'GET', '/workflows');
      console.log(JSON.stringify(list, null, 2));
      return;
    }
    case 'runs': {
      const run = await api<unknown>(config, 'GET', `/runs/${rest[0]}`);
      const trace = (await api<unknown[]>(config, 'GET', `/runs/${rest[0]}/trace`)) as {
        type: string;
      }[];
      console.log(
        JSON.stringify({ run, events: trace.map((e) => e.type) }, null, 2),
      );
      return;
    }
    default:
      throw new Error(`unknown command '${cmd}'. Try 'jack help'.`);
  }

  function sub(): string {
    return rest[0] ?? '';
  }
}

main().catch((err: Error) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
