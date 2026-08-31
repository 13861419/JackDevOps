import { useMemo, useState } from 'react';

interface Action {
  label: string;
  hash: string;
  keywords?: string;
}

const ACTIONS: Action[] = [
  { label: '工作台', hash: '#/' },
  { label: '上手向导 · 10 分钟跑通首条流水线', hash: '#/onboarding' },
  { label: '服务目录', hash: '#/services' },
  { label: '需求与任务', hash: '#/work-items' },
  { label: '流水线', hash: '#/workflows' },
  { label: '运行记录', hash: '#/runs' },
];

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ACTIONS;
    return ACTIONS.filter((a) => a.label.toLowerCase().includes(q) || a.hash.includes(q));
  }, [query]);

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div
        className="palette"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <input
          autoFocus
          placeholder="输入命令或搜索…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onClose();
            }
            if (e.key === 'Enter' && filtered.length > 0) {
              window.location.hash = filtered[0].hash;
              onClose();
            }
          }}
        />
        <ul>
          {filtered.map((action) => (
            <li
              key={action.hash}
              onClick={() => {
                window.location.hash = action.hash;
                onClose();
              }}
            >
              {action.label}
            </li>
          ))}
          {filtered.length === 0 && <li className="muted">无匹配结果</li>}
        </ul>
      </div>
    </div>
  );
}
