import { useEffect, useState } from 'react';
import { api, type Template, type Workflow } from '../api';

export default function Workflows() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState('');

  const load = (): void => {
    api.get<Workflow[]>('/workflows').then(setWorkflows).catch((e) => setError(String(e)));
    api.get<Template[]>('/templates').then(setTemplates).catch(() => undefined);
  };
  useEffect(load, []);

  const run = async (id: string): Promise<void> => {
    setError('');
    try {
      const run = await api.post<{ id: string }>(`/workflows/${id}/runs`);
      window.location.hash = `#/runs/${run.id}`;
    } catch (err) {
      setError(String(err));
    }
  };

  const instantiate = async (slug: string): Promise<void> => {
    setError('');
    try {
      await api.post(`/templates/${slug}/instantiate`, { actorId: 'web' });
      load();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div>
      <h1>流水线</h1>
      {error && <p className="chip failed">{error}</p>}
      <h2>从模板创建</h2>
      <div className="grid">
        {templates.map((t) => (
          <div className="card" key={t.slug}>
            <strong>{t.name}</strong>
            <p className="muted">
              {t.language} · {t.builtin ? '内置模板' : '自定义'}
            </p>
            <button
              onClick={() => {
                void instantiate(t.slug);
              }}
            >
              实例化
            </button>
          </div>
        ))}
      </div>
      <h2>全部流水线（{workflows.length}）</h2>
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>Job 数</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {workflows.map((wf) => (
            <tr key={wf.id}>
              <td>{wf.name}</td>
              <td>{wf.spec.jobs.length}</td>
              <td className="muted">{new Date(wf.createdAt).toLocaleString()}</td>
              <td>
                <button
                  onClick={() => {
                    void run(wf.id);
                  }}
                >
                  运行
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
