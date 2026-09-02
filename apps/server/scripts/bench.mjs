#!/usr/bin/env node
// Simple load benchmark: measures API latency percentiles under concurrency.
// Usage: node scripts/bench.mjs [baseUrl] [token] [total=120] [concurrency=10]
const base = process.argv[2] ?? 'http://localhost:3000';
const token = process.argv[3] ?? 'dev-admin-token';
const total = Number(process.argv[4] ?? 120);
const concurrency = Number(process.argv[5] ?? 10);
const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };

async function timed(path, method = 'GET') {
  const t0 = performance.now();
  const res = await fetch(`${base}${path}`, { method, headers });
  await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return performance.now() - t0;
}

const workflows = await (await fetch(`${base}/workflows`, { headers })).json();
const targets = workflows.filter((w) => w.name.includes('demo')).slice(0, 3);
const pool = targets.length > 0 ? targets : workflows.slice(0, 3);
if (pool.length === 0) throw new Error('no workflows available for bench');

const latencies = [];
let failures = 0;
const worker = async (id) => {
  for (let i = id; i < total; i += concurrency) {
    const wf = pool[i % pool.length];
    try {
      const ms = await timed(`/workflows/${wf.id}/runs`, 'POST');
      latencies.push(ms);
    } catch {
      failures += 1;
    }
  }
};

const t0 = performance.now();
await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
const wall = (performance.now() - t0) / 1000;

latencies.sort((a, b) => a - b);
const pct = (p) => Math.round(latencies[Math.floor((p / 100) * latencies.length)] * 10) / 10;
console.log(`requests: ${latencies.length}/${total} ok (${failures} failed) | wall: ${wall}s | throughput: ${(latencies.length / wall).toFixed(1)} req/s`);
console.log(`p50: ${pct(50)}ms | p90: ${pct(90)}ms | p95: ${pct(95)}ms | p99: ${pct(99)}ms | max: ${Math.round(latencies[latencies.length - 1])}ms`);
