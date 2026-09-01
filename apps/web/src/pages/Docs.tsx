import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface DocView {
  slug: string;
  content?: string;
  updatedAt?: string;
  updatedBy?: string;
  stale: boolean;
  staleReason?: string;
}

export default function Docs() {
  const [docs, setDocs] = useState<DocView[]>([]);
  const [current, setCurrent] = useState<DocView | null>(null);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    api.get<DocView[]>('/docs').then(setDocs).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const open = async (slug: string): Promise<void> => {
    const doc = await api.get<DocView>(`/docs/${slug}`);
    setCurrent(doc);
    setContent(doc.content ?? '');
  };

  const save = async (): Promise<void> => {
    if (!current) return;
    setError('');
    try {
      const saved = await api.put<DocView>(`/docs/${current.slug}`, { content });
      setCurrent(saved);
      reload();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div>
      <h1>TechDocs</h1>
      <p className="muted">docs-like-code 服务文档（B4）：发布提升后未更新文档会自动标记陈旧。</p>
      <div className="two-col">
        <table>
          <thead>
            <tr>
              <th>服务</th>
              <th>状态</th>
              <th>最近更新</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.slug} onClick={() => void open(d.slug)} style={{ cursor: 'pointer' }}>
                <td className="mono">{d.slug}</td>
                <td>
                  <span className={d.stale ? 'chip failed' : 'chip succeeded'}>{d.stale ? '陈旧' : '新鲜'}</span>
                </td>
                <td className="muted">{d.updatedAt ? new Date(d.updatedAt).toLocaleString() : '-'}</td>
              </tr>
            ))}
            {docs.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  暂无服务
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div>
          {current ? (
            <>
              <h3>
                {current.slug}{' '}
                {current.stale && <span className="chip failed">陈旧: {current.staleReason}</span>}
              </h3>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={16}
                style={{ width: '100%' }}
              />
              <button onClick={() => void save()}>保存</button>
            </>
          ) : (
            <p className="muted">从左侧选择服务查看/编辑文档</p>
          )}
        </div>
      </div>
      {error && <p className="chip failed">{error}</p>}
    </div>
  );
}
