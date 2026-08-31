import { useEffect, useState } from 'react';
import { api } from '../api';

interface Flag {
  key: string;
  description: string;
  rolloutPercent: number;
}

export default function Flags() {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [stale, setStale] = useState<string[]>([]);
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [rollout, setRollout] = useState(0);
  const [error, setError] = useState('');

  const load = (): void => {
    api.get<Flag[]>('/flags').then(setFlags).catch((e) => setError(String(e)));
    api.get<Flag[]>('/flags/stale?days=30').then((s) => setStale(s.map((f) => f.key))).catch(() => undefined);
  };

  useEffect(load, []);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/flags', { key, description, rolloutPercent: rollout, actorId: 'web' });
      setKey('');
      setDescription('');
      setRollout(0);
      load();
    } catch (err) {
      setError(String(err));
    }
  };

  const updateRollout = async (flagKey: string, percent: number): Promise<void> => {
    setError('');
    try {
      await api.post(`/flags/${flagKey}/rollout`, { percent, actorId: 'web' });
      load();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div>
      <h1>特性开关</h1>
      <form
        className="inline"
        onSubmit={(e) => {
          void create(e);
        }}
      >
        <input placeholder="flag key（如 new-checkout）" value={key} onChange={(e) => setKey(e.target.value)} required />
        <input placeholder="描述（可选）" value={description} onChange={(e) => setDescription(e.target.value)} />
        <input
          type="number"
          min={0}
          max={100}
          value={rollout}
          onChange={(e) => setRollout(Number(e.target.value))}
          style={{ width: 90 }}
        />
        <button className="primary" type="submit">
          创建
        </button>
      </form>
      {error && <p className="chip failed">{error}</p>}
      <h2>开关列表（{flags.length}）</h2>
      {flags.length === 0 ? (
        <p className="muted">还没有特性开关。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>描述</th>
              <th>放量</th>
              <th>调整</th>
              <th>健康度</th>
            </tr>
          </thead>
          <tbody>
            {flags.map((f) => (
              <tr key={f.key}>
                <td className="mono">{f.key}</td>
                <td>{f.description || '-'}</td>
                <td>{f.rolloutPercent}%</td>
                <td>
                  {[0, 10, 50, 100].map((p) => (
                    <button
                      key={p}
                      style={{ marginRight: 4 }}
                      onClick={() => {
                        void updateRollout(f.key, p);
                      }}
                    >
                      {p}%
                    </button>
                  ))}
                </td>
                <td>
                  <span className="chip">{stale.includes(f.key) ? 'stale' : 'active'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted">30 天未被评估的开关标记为 stale，建议清理（Unleash 式技术债提醒）。</p>
    </div>
  );
}
