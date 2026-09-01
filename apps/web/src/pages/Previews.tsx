import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface PreviewEnv {
  id: string;
  traceId: string;
  serviceId: string;
  prNumber: number;
  prTitle?: string;
  branch?: string;
  commit?: string;
  url?: string;
  status: 'creating' | 'ready' | 'destroyed';
  createdAt: string;
  ttlHours: number;
}

const statusClass: Record<PreviewEnv['status'], string> = {
  creating: 'chip',
  ready: 'chip succeeded',
  destroyed: 'chip failed',
};

export default function Previews() {
  const [previews, setPreviews] = useState<PreviewEnv[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [prNumber, setPrNumber] = useState('');
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    api.get<PreviewEnv[]>('/previews').then(setPreviews).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const request = async (): Promise<void> => {
    setError('');
    try {
      await api.post('/previews', { serviceId, prNumber: Number(prNumber) });
      setPrNumber('');
      reload();
    } catch (e) {
      setError(String(e));
    }
  };

  const destroy = async (id: string): Promise<void> => {
    await api.del(`/previews/${id}`);
    reload();
  };

  return (
    <div>
      <h1>预览环境</h1>
      <p className="muted">PR 级一次性环境（D8）：PR 打开自动创建，关闭自动回收，TTL 过期可清理。</p>
      <div className="toolbar">
        <input placeholder="服务 slug" value={serviceId} onChange={(e) => setServiceId(e.target.value)} />
        <input
          placeholder="PR 编号"
          type="number"
          value={prNumber}
          onChange={(e) => setPrNumber(e.target.value)}
        />
        <button onClick={() => void request()} disabled={!serviceId || !prNumber}>
          手动创建
        </button>
        <button className="ghost" onClick={reload}>
          刷新
        </button>
      </div>
      {error && <p className="chip failed">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>PR</th>
            <th>服务</th>
            <th>状态</th>
            <th>访问地址</th>
            <th>TTL</th>
            <th>创建时间</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {previews.map((p) => (
            <tr key={p.id}>
              <td>
                #{p.prNumber} {p.prTitle && <span className="muted">{p.prTitle}</span>}
              </td>
              <td>{p.serviceId}</td>
              <td>
                <span className={statusClass[p.status]}>{p.status}</span>
              </td>
              <td className="mono">{p.url ?? '-'}</td>
              <td className="muted">{p.ttlHours}h</td>
              <td className="muted">{new Date(p.createdAt).toLocaleString()}</td>
              <td>
                {p.status !== 'destroyed' && (
                  <button className="ghost" onClick={() => void destroy(p.id)}>
                    回收
                  </button>
                )}
              </td>
            </tr>
          ))}
          {previews.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                暂无预览环境，推送 PR 或手动创建
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
