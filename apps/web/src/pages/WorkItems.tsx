import { useEffect, useState } from 'react';
import { api, WORK_ITEM_TRANSITIONS, STATUS_LABELS, type WorkItem } from '../api';

export default function WorkItems() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('task');
  const [error, setError] = useState('');

  const load = (): void => {
    api.get<WorkItem[]>('/work-items').then(setItems).catch((e) => setError(String(e)));
  };
  useEffect(load, []);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/work-items', { title, kind, actorId: 'web' });
      setTitle('');
      load();
    } catch (err) {
      setError(String(err));
    }
  };

  const transition = async (id: string, to: string): Promise<void> => {
    setError('');
    try {
      await api.post(`/work-items/${id}/status`, { to, actorId: 'web' });
      load();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div>
      <h1>需求与任务</h1>
      <form
        className="inline"
        onSubmit={(e) => {
          void create(e);
        }}
      >
        <input placeholder="标题" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="requirement">需求</option>
          <option value="task">任务</option>
          <option value="bug">缺陷</option>
        </select>
        <button className="primary" type="submit">
          创建
        </button>
      </form>
      {error && <p className="chip failed">{error}</p>}
      <h2>工作项（{items.length}）</h2>
      <table>
        <thead>
          <tr>
            <th>标题</th>
            <th>类型</th>
            <th>状态</th>
            <th>流转</th>
            <th>变更指纹</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.title}</td>
              <td>{item.kind}</td>
              <td>
                <span className={`chip ${item.status}`}>{STATUS_LABELS[item.status] ?? item.status}</span>
              </td>
              <td>
                {WORK_ITEM_TRANSITIONS[item.status]?.map((to) => (
                  <button
                    key={to}
                    style={{ marginRight: 6 }}
                    onClick={() => {
                      void transition(item.id, to);
                    }}
                  >
                    → {STATUS_LABELS[to]}
                  </button>
                ))}
              </td>
              <td className="mono muted">{item.traceId.slice(0, 12)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
