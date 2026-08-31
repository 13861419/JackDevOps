import { useState } from 'react';
import { api, type ServiceView, type Workflow } from '../api';

interface QuickstartResult {
  service: ServiceView;
  workflow: Workflow | null;
  guide: { webhookUrl: string; runNow: string; nextSteps: string[] };
}

export default function Onboarding() {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('node');
  const [result, setResult] = useState<QuickstartResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const res = await api.post<QuickstartResult>('/onboarding/quickstart', {
        name,
        language,
        ownerId: 'web',
      });
      setResult(res);
      setStep(3);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const runNow = async (): Promise<void> => {
    if (!result?.workflow) return;
    setBusy(true);
    try {
      const run = await api.post<{ id: string }>(`/workflows/${result.workflow.id}/runs`);
      window.location.hash = `#/runs/${run.id}`;
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>上手向导</h1>
      <p className="muted">目标：10 分钟内跑通你的第一条流水线。</p>
      <div className="steps">
        {[1, 2, 3].map((n) => (
          <span key={n} className="step-dot">
            {n}
            <span style={{ marginLeft: 6 }}>{['服务信息', '确认', '完成'][n - 1]}</span>
          </span>
        ))}
      </div>

      {step === 1 && (
        <div className="card">
          <h2>第 1 步 · 服务信息</h2>
          <form
            className="inline"
            onSubmit={(e) => {
              e.preventDefault();
              setStep(2);
            }}
          >
            <input
              placeholder="服务名称（如：订单服务）"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="node">Node.js</option>
              <option value="go">Go</option>
              <option value="python">Python</option>
            </select>
            <button className="primary" type="submit">
              下一步
            </button>
          </form>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <h2>第 2 步 · 确认</h2>
          <p>
            将创建服务 <strong>{name}</strong>（{language}），并从内置模板生成一条
            <strong> 扫描 → 构建 → 测试 → 部署</strong> 流水线。
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              void submit();
            }}
          >
            {busy ? '创建中…' : '一键创建'}
          </button>
          <button
            onClick={() => {
              setStep(1);
            }}
          >
            上一步
          </button>
        </div>
      )}

      {step === 3 && result && (
        <div className="card">
          <h2>完成！</h2>
          <p>
            服务 <strong>{result.service.name}</strong> 已注册，流水线{' '}
            <strong>{result.workflow?.name ?? '（模板缺失）'}</strong> 已就绪。
          </p>
          <p className="mono">Webhook: {result.guide.webhookUrl}</p>
          <ul className="timeline">
            {result.guide.nextSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <div className="wizard-next">
            <button className="primary" disabled={busy} onClick={() => void runNow()}>
              立即运行流水线
            </button>
            <button onClick={() => (window.location.hash = '#/')}>回到工作台</button>
          </div>
        </div>
      )}

      {error && <p className="chip failed">{error}</p>}
    </div>
  );
}
