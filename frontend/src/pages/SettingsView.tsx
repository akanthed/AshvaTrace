import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SystemStatus } from '../types';
import { api } from '../services/api';
import { LoadingSpinner } from '../components/LoadingSpinner';

function StatusPill({ ok }: { ok: boolean }) {
  return <span className={`pill ${ok ? 'ok' : 'warn'}`}>{ok ? 'Connected' : 'Not connected'}</span>;
}

export function SettingsView() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getSystemStatus()
      .then(setStatus)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner label="Loading settings…" />;

  return (
    <div className="view">
      <div className="inc-head">
        <h1>Settings</h1>
        <div className="sp" />
        <Link to="/">← Home</Link>
      </div>

      <section className="panel">
        <header>
          <h3>What's actually connected</h3>
          <div className="sp" />
          <span className="prov">Live check, not a claim</span>
        </header>
        <div className="body" style={{ display: 'grid', gap: 16 }}>
          {error && <p className="prov" style={{ color: 'var(--crit)' }}>Couldn't reach the server to check status.</p>}

          {status && (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Status</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>AI (hypothesis &amp; simulation)</td>
                    <td><StatusPill ok={status.ai.configured} /></td>
                    <td className="mono">{status.ai.model} · {status.ai.location}</td>
                  </tr>
                  <tr>
                    <td>BigQuery (historical readings)</td>
                    <td><StatusPill ok={status.bigquery.configured} /></td>
                    <td className="mono">{status.bigquery.dataset}</td>
                  </tr>
                  <tr>
                    <td>Pub/Sub (alert broadcast)</td>
                    <td><StatusPill ok={status.pubsub.configured} /></td>
                    <td className="mono">{status.pubsub.topic ?? 'no topic configured'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <p className="prov">
            Machine data on every other screen is simulated — there is no real PLC or CNC connection.
          </p>
        </div>
      </section>
    </div>
  );
}
