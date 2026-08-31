import { useEffect, useState } from 'react';
import { api, STATUS_LABELS, type DomainEventView, type Run } from '../api';

export function Runs() {
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    api.get<Run[]>('/runs').then(setRuns).catch(() => undefined);
  }, []);

  return (
    <div>
      <h1>运行记录</h1>
      {runs.length === 0 ? (
        <p className="muted">还没有运行记录。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>运行</th>
              <th>工作流</th>
              <th>状态</th>
              <th>提交</th>
              <th>开始时间</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="mono">
                  <a href={`#/runs/${r.id}`}>{r.id.slice(0, 12)}</a>
                </td>
                <td>{r.workflowName ?? r.workflowId}</td>
                <td>
                  <span className={`chip ${r.status}`}>{STATUS_LABELS[r.status] ?? r.status}</span>
                </td>
                <td className="mono">{r.meta?.commit ?? '-'}</td>
                <td className="muted">{new Date(r.startedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function RunDetail({ id }: { id: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [trace, setTrace] = useState<DomainEventView[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Run>(`/runs/${id}`).then(setRun).catch((e) => setError(String(e)));
    api.get<DomainEventView[]>(`/runs/${id}/trace`).then(setTrace).catch(() => undefined);
  }, [id]);

  if (error) {
    return <p className="chip failed">{error}</p>;
  }
  if (!run) {
    return <p className="muted">加载中…</p>;
  }

  return (
    <div>
      <h1>
        运行 <span className="mono">{id}</span> <span className={`chip ${run.status}`}>{STATUS_LABELS[run.status] ?? run.status}</span>
      </h1>
      <div className="card">
        <h2>Job 状态</h2>
        <table>
          <tbody>
            {(run.jobs ?? []).map((j) => (
              <tr key={j.id}>
                <td>{j.id}</td>
                <td>{j.type}</td>
                <td>
                  <span className={`chip ${j.status}`}>{STATUS_LABELS[j.status] ?? j.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>变更指纹 · 事件链</h2>
      <p className="muted mono">traceId: {run.traceId}</p>
      <ul className="timeline">
        {trace.map((e) => (
          <li key={e.eventId}>
            <strong>{e.type}</strong> · {e.actor.type}:{e.actor.id} · {new Date(e.occurredAt).toLocaleTimeString()}
          </li>
        ))}
      </ul>
      <p>
        <a href="#/runs">← 返回运行列表</a>
      </p>
    </div>
  );
}
