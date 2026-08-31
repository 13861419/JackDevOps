export default function App() {
  return (
    <main style={styles.main}>
      <div style={styles.badge}>Phase 0 · Scaffold</div>
      <h1 style={styles.title}>JackDevOps</h1>
      <p style={styles.subtitle}>
        开源的、AI-ready 的全流程 DevOps 平台 —— 需求 → 开发 → 测试 → 发布 → 运维
      </p>
      <ul style={styles.list}>
        <li>服务目录为轴心，一切实体皆目录中的实体</li>
        <li>事件溯源 + 变更指纹，全链路可追溯</li>
        <li>北极星指标：安装到首条流水线 ≤ 10 分钟</li>
      </ul>
      <p style={styles.footer}>
        文档见 <code>docs/</code> · API 健康检查 <code>GET /health</code>
      </p>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: '100vh',
    background: '#0d1117',
    color: '#e6edf3',
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    textAlign: 'center',
  },
  badge: {
    border: '1px solid #30363d',
    borderRadius: 999,
    padding: '4px 14px',
    fontSize: 13,
    color: '#8b949e',
  },
  title: {
    fontSize: 48,
    margin: 0,
    background: 'linear-gradient(90deg, #58a6ff, #bc8cff)',
    WebkitBackgroundClip: 'text',
    color: 'transparent',
  },
  subtitle: {
    fontSize: 18,
    color: '#8b949e',
    margin: 0,
  },
  list: {
    textAlign: 'left',
    color: '#c9d1d9',
    lineHeight: 2,
    margin: 0,
  },
  footer: {
    color: '#8b949e',
    fontSize: 14,
  },
};
