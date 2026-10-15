import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMachines } from '../hooks/useMachines';
import { api } from '../services/api';
import type { Incident } from '../types';

const OPEN_STATUSES: Incident['status'][] = ['open', 'investigating', 'action_taken'];

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
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [openIncidentByMachine, setOpenIncidentByMachine] = useState<Map<string, string>>(new Map());
  const [incidentMachineId, setIncidentMachineId] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .getIncidents()
        .then((incidents) => {
          if (cancelled) return;
          const next = new Map<string, string>();
          for (const inc of incidents) {
            if (OPEN_STATUSES.includes(inc.status)) next.set(inc.machineId, inc.id);
          }
          setOpenIncidentByMachine(next);
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Extract the route id from the pathname (the Sidebar is rendered outside
  // <Routes>, so useParams() is unavailable here).
  const machineMatch = location.pathname.match(/^\/machine\/([^/]+)/);
  const incidentMatch = location.pathname.match(/^\/incident\/([^/]+)/);
  const isIncidentRoute = !!incidentMatch;

  // On an incident page, the route param is the incident id, not a machine
  // id — resolve it to a machine id so the right sidebar row still highlights.
  useEffect(() => {
    if (!isIncidentRoute || !incidentMatch?.[1]) {
      setIncidentMachineId(undefined);
      return;
    }
    let cancelled = false;
    api
      .getIncident(incidentMatch[1])
      .then((inc) => {
        if (!cancelled) setIncidentMachineId(inc.machineId);
      })
      .catch(() => {
        if (!cancelled) setIncidentMachineId(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [isIncidentRoute, incidentMatch?.[1]]);

  const selectedId = isIncidentRoute ? incidentMachineId : machineMatch?.[1];

  // Machine `type` values are lowercase process names from the backend
  // ('milling', 'turning', 'grinding', 'stamping'), not 'Mill'/'Lathe' — group
  // cutting processes (mill/lathe) as Line 1, finishing processes (grinder/press)
  // as Line 2.
  const grouped = useMemo(() => {
    const lines = new Map<string, typeof machines>();
    for (const m of machines) {
      const line = m.type === 'milling' || m.type === 'turning' ? 'Line 1' : 'Line 2';
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
                  onClick={() => {
                    const openIncidentId = openIncidentByMachine.get(m.id);
                    navigate(openIncidentId ? `/incident/${openIncidentId}` : `/machine/${m.id}`);
                  }}
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
