import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMachines } from '../hooks/useMachines';

function statusToSt(status: string): 'ok' | 'warn' | 'crit' {
  if (status === 'critical') return 'crit';
  if (status === 'warning') return 'warn';
  return 'ok';
}

function statusLabel(status: string): string {
  if (status === 'critical') return 'Action required';
  if (status === 'warning') return 'Watch';
  return 'Normal';
}

export default function Sidebar() {
  const { machines, statuses } = useMachines();
  const { id: selectedId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const lines = new Map<string, typeof machines>();
    for (const m of machines) {
      const line = m.type.includes('Mill') || m.type.includes('Lathe') ? 'Line 1' : 'Line 2';
      if (!lines.has(line)) lines.set(line, []);
      lines.get(line)!.push(m);
    }
    return lines;
  }, [machines]);

  const filtered = (list: typeof machines) => {
    if (!query) return list;
    const q = query.toLowerCase();
    return list.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.type.toLowerCase().includes(q),
    );
  };

  return (
    <nav className="tree">
      <div className="search">
        <input
          type="search"
          placeholder="Search in navigator"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {[...grouped.entries()].map(([line, list]) => {
        const items = filtered(list);
        if (items.length === 0) return null;
        return (
          <div key={line}>
            <h4>{line}</h4>
            {items.map((m) => {
              const st = statuses.get(m.id)?.status ?? 'normal';
              const stClass = statusToSt(st);
              const isSel = m.id === selectedId;
              return (
                <button
                  key={m.id}
                  className={`m${isSel ? ' sel' : ''}`}
                  onClick={() => navigate(`/machine/${m.id}`)}
                >
                  <span className={`st ${stClass}`} />
                  <span>
                    {m.id}
                    <br />
                    <small>{m.name}</small>
                  </span>
                  <small>{statusLabel(st)}</small>
                </button>
              );
            })}
          </div>
        );
      })}

      <div className="legend">
        <span>
          <span className="st ok" /> Normal
        </span>
        <span>
          <span className="st warn" /> Watch
        </span>
        <span>
          <span className="st crit" /> Action required
        </span>
      </div>
    </nav>
  );
}
