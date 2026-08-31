import { useEffect, useState } from 'react';
import { api } from '../api';

interface Suite {
  id: string;
  name: string;
  serviceId: string;
  command?: string;
  tags: string[];
}

interface SelectResult {
  suites: Suite[];
  reasons: Record<string, string>;
}

export default function Tests() {
  const [suites, setSuites] = useState<Suite[]>([]);
  const [selected, setSelected] = useState<SelectResult | null>(null);
  const [paths, setPaths] = useState('src/, tests/');
  const [name, setName] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [command, setCommand] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    api.get<Suite[]>('/test-suites').then(setSuites).catch((e) => setError(String(e)));
  };
  useEffect(load, []);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/test-suites', {
        name,
        serviceId,
        command: command || undefined,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        actorId: 'web',
      });
      setName('');
      setCommand('');
      setTags('');
      load();
    } catch (err) {
      setError(String(err));
    }
  };

  const runSelect = async (): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      const sid = serviceId || suites[0]?.serviceId || '';
      const res = await api.post<SelectResult>('/test-suites/select', {
        serviceId: sid,
        changedPaths: paths.split(',').map((p) => p.trim()).filter(Boolean),
      });
      setSelected(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const record = async (suiteId: string): Promise<void> => {
    setError('');
    try {
      await api.post(`/test-suites/${suiteId}/runs`, {
        passed: 5,
        failed: 0,
        durationMs: 1200,
        actorId: 'web',
      });
      load();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div>
      <h1>测试管理</h1>
      <h2>智能选择（C4 规则版）</h2>
      <div className="card">
        <form
          className="inline"
          onSubmit={(e) => {
            e.preventDefault();
            void runSelect();
          }}
        >
          <input
            placeholder="变更路径（逗号分隔）"
            value={paths}
            onChange={(e) => setPaths(e.target.value)}
            style={{ minWidth: 320 }}
          />
          <button className="primary" type="submit" disabled={busy}>
            推荐要跑的测试
          </button>
        </form>
        {selected && (
          <table style={{ marginTop: 10 }}>
            <tbody>
              {selected.suites.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="muted">{selected.reasons[s.id]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>注册测试套件</h2>
      <form
        className="inline"
        onSubmit={(e) => {
          void create(e);
        }}
      >
        <input placeholder="套件名" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="服务 ID" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required />
        <input placeholder="命令（可选）" value={command} onChange={(e) => setCommand(e.target.value)} />
        <input placeholder="标签（逗号分隔）" value={tags} onChange={(e) => setTags(e.target.value)} />
        <button className="primary" type="submit">
          注册
        </button>
      </form>

      <h2>套件列表（{suites.length}）</h2>
      {suites.length === 0 ? (
        <p className="muted">还没有测试套件。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>服务</th>
              <th>标签</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {suites.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="mono">{s.serviceId}</td>
                <td>{s.tags.join(', ') || '-'}</td>
                <td>
                  <button
                    onClick={() => {
                      void record(s.id);
                    }}
                  >
                    记录一次通过
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
