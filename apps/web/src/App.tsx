import { useEffect, useState, type ReactNode } from 'react';
import Dashboard from './pages/Dashboard';
import Services from './pages/Services';
import WorkItems from './pages/WorkItems';
import Workflows from './pages/Workflows';
import { Runs, RunDetail } from './pages/Runs';
import Onboarding from './pages/Onboarding';
import Flags from './pages/Flags';
import Tests from './pages/Tests';
import Audit from './pages/Audit';
import CommandPalette from './components/CommandPalette';
import AiSidebar from './components/AiSidebar';

const NAV = [
  { hash: '#/', label: '工作台' },
  { hash: '#/onboarding', label: '上手向导' },
  { hash: '#/services', label: '服务目录' },
  { hash: '#/work-items', label: '需求与任务' },
  { hash: '#/workflows', label: '流水线' },
  { hash: '#/runs', label: '运行记录' },
  { hash: '#/tests', label: '测试管理' },
  { hash: '#/flags', label: '特性开关' },
  { hash: '#/audit', label: '审计' },
];

function useHashRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const onChange = (): void => setRoute(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export default function App() {
  const route = useHashRoute();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="brand">JackDevOps</div>
        {NAV.map((item) => (
          <a
            key={item.hash}
            href={item.hash}
            className={route === item.hash || (item.hash !== '#/' && route.startsWith(item.hash)) ? 'active' : ''}
          >
            {item.label}
          </a>
        ))}
        <div className="hint">
          按 <span className="kbd">Ctrl K</span> 打开命令面板
        </div>
      </nav>
      <main className="content">{renderRoute(route)}</main>
      <button className="ai-fab" onClick={() => setAiOpen(true)}>
        AI
      </button>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      {aiOpen && <AiSidebar onClose={() => setAiOpen(false)} />}
    </div>
  );
}

function renderRoute(route: string): ReactNode {
  if (route === '#/') return <Dashboard />;
  if (route.startsWith('#/onboarding')) return <Onboarding />;
  if (route.startsWith('#/services')) return <Services />;
  if (route.startsWith('#/work-items')) return <WorkItems />;
  if (route.startsWith('#/workflows')) return <Workflows />;
  if (route.startsWith('#/flags')) return <Flags />;
  if (route.startsWith('#/tests')) return <Tests />;
  if (route.startsWith('#/audit')) return <Audit />;
  if (route.startsWith('#/runs/')) return <RunDetail id={route.slice('#/runs/'.length)} />;
  if (route.startsWith('#/runs')) return <Runs />;
  return <Dashboard />;
}
