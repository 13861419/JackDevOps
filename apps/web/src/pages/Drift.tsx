import { useState } from 'react';
import { api } from '../api';

interface DriftReport {
  slug: string;
  desired: { version?: string; image?: string };
  actual: { image?: string };
  drifts: { field: string; desired: string; actual: string }[];
  hasDrift: boolean;
  checkedAt: string;
}

export default function Drift() {
  const [slug, setSlug] = useState('');
  const [image, setImage] = useState('');
  const [report, setReport] = useState<DriftReport | null>(null);
  const [error, setError] = useState('');

  const check = async (): Promise<void> => {
    setError('');
    try {
      setReport(await api.post<DriftReport>(`/drift/${slug}/check`, { image }));
    } catch (e) {
      setError(String(e));
    }
  };

  const reconcile = async (): Promise<void> => {
    setError('');
    try {
      await api.post(`/drift/${slug}/reconcile`, { actorId: 'web' });
      setReport(null);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div>
      <h1>配置漂移</h1>
      <p className="muted">
        期望状态（最近一次 promote 的制品）与实际状态的对比（F7），一键确认 reconcile。
      </p>
      <div className="toolbar">
        <input placeholder="服务 slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
        <input placeholder="实际镜像 (如 registry/app:v1)" value={image} onChange={(e) => setImage(e.target.value)} />
        <button onClick={() => void check()} disabled={!slug}>
          检测
        </button>
        <button className="ghost" onClick={() => void reconcile()} disabled={!slug}>
          标记已调和
        </button>
      </div>
      {error && <p className="chip failed">{error}</p>}
      {report && (
        <div>
          <h3>
            {report.slug}{' '}
            <span className={report.hasDrift ? 'chip failed' : 'chip succeeded'}>
              {report.hasDrift ? '发现漂移' : '无漂移'}
            </span>
          </h3>
          <table>
            <thead>
              <tr>
                <th>字段</th>
                <th>期望</th>
                <th>实际</th>
              </tr>
            </thead>
            <tbody>
              {report.drifts.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    期望 = 实际，环境一致
                  </td>
                </tr>
              )}
              {report.drifts.map((d) => (
                <tr key={d.field}>
                  <td className="mono">{d.field}</td>
                  <td className="mono">{d.desired}</td>
                  <td className="mono">{d.actual}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">检测时间: {new Date(report.checkedAt).toLocaleString()}</p>
        </div>
      )}
    </div>
  );
}
