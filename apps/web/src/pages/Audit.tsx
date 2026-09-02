import { useEffect, useState } from 'react';
import { api, type DomainEventView } from '../api';

export default function Audit() {
  const [events, setEvents] = useState<DomainEventView[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<{ total: number; events: DomainEventView[] }>('/audit?limit=200')
      .then((res) => setEvents(res.events ?? []))
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      <h1>审计日志</h1>
      <p className="muted">全平台事件的只读时间线（F3）， newest first。</p>
      {error && <p className="chip failed">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>事件</th>
            <th>聚合</th>
            <th>操作者</th>
            <th>变更指纹</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.eventId}>
              <td className="muted">{new Date(e.occurredAt).toLocaleString()}</td>
              <td>
                <span className="chip">{e.type}</span>
              </td>
              <td className="mono">{e.aggregateType}/{e.aggregateId.slice(0, 12)}</td>
              <td>{e.actor.type}:{e.actor.id}</td>
              <td className="mono muted">{e.traceId.slice(0, 12)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
