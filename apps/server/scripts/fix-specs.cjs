const fs = require('fs');
for (const f of fs.readdirSync('test')) {
  if (!f.endsWith('.spec.ts')) continue;
  const p = 'test/' + f;
  let c = fs.readFileSync(p, 'utf8');
  const before = c.length;
  c = c.replace(/new WorkflowRunsService\((store\d*), (registry|new JobRegistry\(\))\)/g, 'new WorkflowRunsService($1, $2, new RunExecutor($1, $2))');
  if (!c.includes('run-executor')) {
    c = "import { RunExecutor } from '../src/modules/runqueue/run-executor.service';\n" + c;
  }
  fs.writeFileSync(p, c, 'utf8');
  console.log(f, before !== c.length ? 'changed' : 'unchanged');
}
