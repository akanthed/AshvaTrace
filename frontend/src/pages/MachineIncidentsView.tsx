import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Incident } from '../types';
import { api } from '../services/api';
import { LoadingSpinner } from '../components/LoadingSpinner';

// Mirrors the backend's OPEN_STATUSES (incidentService.ts) — only these
// three statuses mean the incident still needs investigation/action.
const OPEN_STATUSES = ['open', 'investigating', 'action_taken'];

function IncidentRow({ inc, onClick }: { inc: Incident; onClick: () => void }) {
  const isOpen = OPEN_STATUSES.includes(inc.status);
  return (
    <article className="hyp" onClick={onClick} style={{ cursor: 'pointer' }}>
      <h4 style={{ fontSize: 13 }}>
        <span className="rank">{inc.id}</span>
        <span className={`pill ${isOpen ? 'crit' : 'ok'}`} style={{ fontSize: 11 }}>
          {isOpen ? 'Open' : 'Resolved'}
        </span>
        <span className="pill info" style={{ fontSize: 11 }}>{inc.devPct}% off normal</span>
        <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 'auto' }}>
          {new Date(inc.detectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </h4>
      {!isOpen && (
        <div style={{ fontSize: 12, display: 'grid', gap: 3, marginTop: 4 }}>
          {inc.hypotheses.length > 0 && (
            <span>
              <span style={{ color: 'var(--muted)' }}>Cause: </span>
              {inc.hypotheses[0].title}
            </span>
          )}
          {inc.simulation?.action && (
            <span>
              <span style={{ color: 'var(--muted)' }}>Fix: </span>
              {inc.simulation.action}
            </span>
          )}
          {inc.verification && (
            <span style={{ color: inc.verification.passed ? 'var(--ok)' : 'var(--crit)' }}>
              {inc.verification.passed ? '✓ Fix worked' : '✗ Fix did not work'}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

export function MachineIncidentsView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .getIncidentsByMachine(id)
      .then((list) => {
        const sorted = [...list].sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
        setIncidents(sorted);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <LoadingSpinner label="Loading problems…" />;

  const open = incidents.filter((i) => OPEN_STATUSES.includes(i.status));
  const closed = incidents.filter((i) => !OPEN_STATUSES.includes(i.status));
  const machineName = incidents[0]?.machineName ?? id;

  return (
    <div className="view">
      <div className="inc-head">
        <h1>{machineName}</h1>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>
          {open.length} open · {closed.length} solved
        </span>
      </div>

      <section className="panel">
        <header>
          <h3>Open problems</h3>
        </header>
        <div className="body" style={{ display: 'grid', gap: 8 }}>
          {open.length === 0 ? (
            <div className="empty">
              <b style={{ color: 'var(--fg)' }}>No open problems</b>
              Nothing needs attention right now.
            </div>
          ) : (
            open.map((inc) => (
              <IncidentRow key={inc.id} inc={inc} onClick={() => navigate(`/incident/${inc.id}?tab=investigate`)} />
            ))
          )}
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <header>
          <h3>Solved problems</h3>
        </header>
        <div className="body" style={{ display: 'grid', gap: 8 }}>
          {closed.length === 0 ? (
            <div className="empty">
              <b style={{ color: 'var(--fg)' }}>No solved problems</b>
              This machine has no past problems yet.
            </div>
          ) : (
            closed.map((inc) => (
              <IncidentRow key={inc.id} inc={inc} onClick={() => navigate(`/incident/${inc.id}?tab=investigate`)} />
            ))
          )}
        </div>
      </section>
    </div>
  );
}
