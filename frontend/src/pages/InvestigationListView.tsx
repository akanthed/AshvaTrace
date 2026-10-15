import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Incident } from '../types';
import { api } from '../services/api';
import { LoadingSpinner } from '../components/LoadingSpinner';

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

  useEffect(() => {
    api
      .getIncidents()
      .then((all) => {
        const open = all.filter((i) => OPEN_STATUSES.includes(i.status));
        open.sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
        setIncidents(open);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner label="Loading open incidents…" />;

  return (
    <div className="view">
      <div className="inc-head">
        <h1>Investigate</h1>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>
          {incidents.length} open incident{incidents.length === 1 ? '' : 's'} across the plant
        </span>
      </div>

      <section className="panel">
        <header>
          <h3>Open incidents</h3>
        </header>
        <div className="body">
          {incidents.length === 0 ? (
            <div className="empty">
              <b style={{ color: 'var(--fg)' }}>No open incidents</b>
              Nothing needs investigation right now.
            </div>
          ) : (
            <div className="tbl-wrap">
              <table className="mtable">
                <thead>
                  <tr>
                    <th>Incident</th>
                    <th>Machine</th>
                    <th className="num">Deviation</th>
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
                        <span className={`pill ${pillClass(inc.severity)}`}>{inc.severity}</span>
                      </td>
                      <td>{inc.status}</td>
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
