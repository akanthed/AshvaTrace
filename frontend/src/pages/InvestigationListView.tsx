import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Incident } from '../types';
import { api } from '../services/api';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ResetDemoButton } from '../components/ResetDemoButton';

function pillClass(severity: string): string {
  return severity === 'critical' ? 'crit' : 'warn';
}

// Mirrors the backend's OPEN_STATUSES (incidentService.ts) — 'verified' and
// 'closed' are both resolved; only these three statuses mean the incident
// still needs investigation/action.
const OPEN_STATUSES = ['open', 'investigating', 'action_taken'];

export function InvestigationListView() {
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () =>
    Promise.all([api.getIncidents(), api.getMachines().catch(() => null)])
      .then(([all, machines]) => {
        // Skip incidents for machines that have since been removed from the plant.
        const known = machines ? new Set(machines.map((m) => m.id)) : null;
        const open = all.filter((i) => OPEN_STATUSES.includes(i.status) && (!known || known.has(i.machineId)));
        open.sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
        setIncidents(open);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  if (loading) return <LoadingSpinner label="Loading open problems…" />;

  return (
    <div className="view">
      <div className="inc-head">
        <h1>Open problems</h1>
        <div className="sp" />
        <ResetDemoButton compact onDone={load} />
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>
          {incidents.length} open problem{incidents.length === 1 ? '' : 's'} in the plant
        </span>
      </div>

      <section className="panel">
        <header>
          <h3>Problems that need attention</h3>
        </header>
        <div className="body">
          {incidents.length === 0 ? (
            <div className="empty">
              <b style={{ color: 'var(--fg)' }}>No open problems</b>
              Everything is running normally.
            </div>
          ) : (
            <div className="tbl-wrap">
              <table className="mtable">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Machine</th>
                    <th className="num">Vs normal</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Detected</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((inc) => (
                    <tr key={inc.id} onClick={() => navigate(`/incident/${inc.id}?tab=investigate`)}>
                      <td>
                        <b>{inc.id}</b>
                      </td>
                      <td>
                        {inc.machineName}
                        <br />
                        <small>{inc.machineId}</small>
                      </td>
                      <td className="num mono">
                        {inc.devPct > 0 ? '+' : ''}
                        {inc.devPct}%
                      </td>
                      <td>
                        <span className={`pill ${pillClass(inc.severity)}`}>{inc.severity === 'critical' ? 'Action required' : 'Watch'}</span>
                      </td>
                      <td>{({ open: 'Open', investigating: 'AI investigating', action_taken: 'Fix being tried', verified: 'Fix verified', closed: 'Closed' } as Record<string, string>)[inc.status] ?? inc.status}</td>
                      <td className="mono">{new Date(inc.detectedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
