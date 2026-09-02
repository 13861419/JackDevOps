import { useEffect, useState } from 'react';
import { api, subscribeLiveRefresh, STATUS_LABELS, type DomainEventView, type Run } from '../api';

export function Runs() {
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    const reload = (): void => {
      api.get<Run[]>('/runs').then(setRuns).catch(() => undefined);
    };
    reload();
    return subscribeLiveRefresh(reload);
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
  const [aiBusy, setAiBusy] = useState('');
  const [aiResult, setAiResult] = useState<{ title: string; text: string } | null>(null);

  const loadTrace = (): void => {
    api.get<DomainEventView[]>(`/runs/${id}/trace`).then(setTrace).catch(() => undefined);
  };

  useEffect(() => {
    api.get<Run>(`/runs/${id}`).then(setRun).catch((e) => setError(String(e)));
    loadTrace();
  }, [id]);

  const askAi = async (kind: 'risk-summary' | 'diagnose'): Promise<void> => {
    setAiBusy(kind);
    setError('');
    setAiResult(null);
    try {
      if (kind === 'risk-summary') {
        const res = await api.post<{ summary: string }>(`/ai/risk-summary/${id}`, { actorId: 'web' });
        setAiResult({ title: 'AI 风险摘要', text: res.summary });
      } else {
        const res = await api.post<{ diagnosis: string }>(`/ai/diagnose/${id}`, { actorId: 'web' });
        setAiResult({ title: 'AI 诊断', text: res.diagnosis });
      }
      loadTrace();
    } catch (err) {
      setError(String(err));
    } finally {
      setAiBusy('');
    }
  };

  if (error) {
    return <p className="chip failed">{error}</p>;
  }
  if (!run) {
    return <p className="muted">加载中…</p>;
  }

  return (
    <div>
      <h1>
        运行 <span className="mono">{id}</span>{' '}
        <span className={`chip ${run.status}`}>{STATUS_LABELS[run.status] ?? run.status}</span>
      </h1>
      <div className="card">
        <h2>AI Copilot（上下文注入自事件链）</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            disabled={aiBusy !== ''}
            onClick={() => {
              void askAi('risk-summary');
            }}
          >
            {aiBusy === 'risk-summary' ? '生成中…' : 'AI 风险摘要'}
          </button>
          <button
            disabled={aiBusy !== ''}
            onClick={() => {
              void askAi('diagnose');
            }}
          >
            {aiBusy === 'diagnose' ? '分析中…' : 'AI 诊断'}
          </button>
        </div>
        {aiResult && (
          <div className="card" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>
            <strong>{aiResult.title}</strong>
            <p style={{ marginBottom: 0 }}>{aiResult.text}</p>
          </div>
        )}
      </div>
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
      <h2>Job 输出（F4）</h2>
      {trace
        .filter((e) => e.type === 'job.succeeded' || e.type === 'job.failed')
        .map((e) => {
          const result = e.payload.result as { stdout?: string; stderr?: string } | undefined;
          const output =
            e.type === 'job.succeeded'
              ? (result?.stdout ?? result?.stderr ?? '')
              : String(e.payload.error ?? '');
          return (
            <div className="card" key={e.eventId}>
              <strong className={e.type === 'job.failed' ? 'chip failed' : 'chip succeeded'}>
                {String(e.payload.jobId)}
              </strong>
              <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>
                {output || '(无输出)'}
              </pre>
            </div>
          );
        })}
      <h2>变更指纹 · 事件链</h2>
      <p className="muted mono">traceId: {run.traceId}</p>
      <ul className="timeline">
        {trace.map((e) => (
          <li key={e.eventId}>
            <strong>{e.type}</strong> · {e.actor.type}:{e.actor.id} ·{' '}
            {new Date(e.occurredAt).toLocaleTimeString()}
          </li>
        ))}
      </ul>
      <p>
        <a href="#/runs">← 返回运行列表</a>
      </p>
    </div>
  );
}
