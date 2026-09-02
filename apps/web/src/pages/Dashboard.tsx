import { useEffect, useState } from 'react';
import { api, subscribeLiveRefresh, type Run, type ServiceView, type Workflow, STATUS_LABELS } from '../api';

interface Dora {
  windowDays: number;
  deployments: number;
  deploymentFrequencyPerDay: number;
  changeFailureRate: number | null;
  mttrMinutes: number | null;
}

export default function Dashboard() {
  const [services, setServices] = useState<ServiceView[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [dora, setDora] = useState<Dora | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const reload = (): void => {
      Promise.all([api.get<ServiceView[]>('/services'), api.get<Workflow[]>('/workflows'), api.get<Run[]>('/runs')])
        .then(([s, w, r]) => {
          setServices(s);
          setWorkflows(w);
          setRuns(r);
        })
        .catch((e) => setError(String(e)));
      api.get<Dora>('/metrics/dora').then(setDora).catch(() => undefined);
    };
    reload();
    return subscribeLiveRefresh(reload);
  }, []);

  return (
    <div>
      <h1>工作台</h1>
      {error && <div className="chip failed">API 不可达：{error}</div>}
      <div className="grid">
        <div className="card">
          <h2>10 分钟上手</h2>
          <p className="muted">从零到第一条流水线：注册服务 → 选模板 → 运行。</p>
          <button className="primary" onClick={() => (window.location.hash = '#/onboarding')}>
            打开上手向导
          </button>
        </div>
        <div className="card">
          <h2>概览</h2>
          <p>服务：{services.length}</p>
          <p>流水线：{workflows.length}</p>
          <p>运行记录：{runs.length}</p>
        </div>
        <div className="card">
          <h2>DORA（近 {dora?.windowDays ?? 30} 天）</h2>
          <p className="muted" style={{ margin: '4px 0' }}>部署 {dora?.deployments ?? 0} 次 · 频率 {dora?.deploymentFrequencyPerDay ?? 0}/天</p>
          <p className="muted" style={{ margin: '4px 0' }}>
            变更失败率: {dora?.changeFailureRate == null ? '-' : `${(dora.changeFailureRate * 100).toFixed(1)}%`}
          </p>
          <p className="muted" style={{ margin: '4px 0' }}>
            MTTR: {dora?.mttrMinutes == null ? '-' : `${dora.mttrMinutes} 分钟`}
          </p>
        </div>
      </div>
      <h2>最近运行</h2>
      {runs.length === 0 ? (
        <p className="muted">还没有运行记录，去上手向导创建第一条流水线吧。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>运行</th>
              <th>工作流</th>
              <th>状态</th>
              <th>开始时间</th>
            </tr>
          </thead>
          <tbody>
            {runs.slice(0, 5).map((r) => (
              <tr key={r.id}>
                <td className="mono">
                  <a href={`#/runs/${r.id}`}>{r.id.slice(0, 12)}</a>
                </td>
                <td>{r.workflowName ?? r.workflowId}</td>
                <td>
                  <span className={`chip ${r.status}`}>{STATUS_LABELS[r.status] ?? r.status}</span>
                </td>
                <td className="muted">{new Date(r.startedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
