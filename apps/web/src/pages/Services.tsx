import { useEffect, useState } from 'react';
import { api, type ServiceView } from '../api';

export default function Services() {
  const [services, setServices] = useState<ServiceView[]>([]);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('node');
  const [error, setError] = useState('');

  const load = (): void => {
    api.get<ServiceView[]>('/services').then(setServices).catch((e) => setError(String(e)));
  };
  useEffect(load, []);

  const register = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/services', { name, language, ownerId: 'web' });
      setName('');
      load();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div>
      <h1>服务目录</h1>
      <form
        className="inline"
        onSubmit={(e) => {
          void register(e);
        }}
      >
        <input placeholder="服务名称" value={name} onChange={(e) => setName(e.target.value)} required />
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="node">Node.js</option>
          <option value="go">Go</option>
          <option value="python">Python</option>
        </select>
        <button className="primary" type="submit">
          注册服务
        </button>
      </form>
      {error && <p className="chip failed">{error}</p>}
      <h2>已注册服务（{services.length}）</h2>
      {services.length === 0 ? (
        <p className="muted">还没有服务。注册一个，或走一遍上手向导。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>Slug</th>
              <th>语言</th>
              <th>负责人</th>
              <th>注册时间</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="mono">{s.slug}</td>
                <td>{s.language ?? '-'}</td>
                <td>{s.ownerId}</td>
                <td className="muted">{new Date(s.registeredAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted">
        没有合适的服务？<a href="#/onboarding">走一遍上手向导</a>，10 分钟跑通第一条流水线。
      </p>
    </div>
  );
}
