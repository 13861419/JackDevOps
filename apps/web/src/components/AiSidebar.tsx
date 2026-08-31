import { useState } from 'react';
import { api } from '../api';

const QUICK_ACTIONS = [
  '分析当前发布风险',
  '总结最近的失败原因',
  '哪些服务最近部署最频繁？',
];

export default function AiSidebar({ onClose }: { onClose: () => void }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ask = async (q: string): Promise<void> => {
    if (!q.trim()) return;
    setBusy(true);
    setError('');
    setAnswer('');
    try {
      const res = await api.post<{ answer: string }>('/ai/chat', { question: q, actorId: 'web' });
      setAnswer(res.answer);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div
        className="ai-drawer"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>AI Copilot</strong>
          <button onClick={onClose}>关闭</button>
        </div>
        <p className="muted">基于平台全链路事件上下文回答（E5）。</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
          {QUICK_ACTIONS.map((q) => (
            <button
              key={q}
              onClick={() => {
                void ask(q);
              }}
            >
              {q}
            </button>
          ))}
        </div>
        <textarea
          placeholder="向 AI 提问，例如：为什么上次的发布失败了？"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          style={{ width: '100%', minHeight: 80, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, fontFamily: 'inherit' }}
        />
        <button
          className="primary"
          style={{ marginTop: 8 }}
          disabled={busy}
          onClick={() => {
            void ask(question);
          }}
        >
          {busy ? '思考中…' : '提问'}
        </button>
        {error && <p className="chip failed">{error}</p>}
        {answer && <div className="card" style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{answer}</div>}
      </div>
    </div>
  );
}
