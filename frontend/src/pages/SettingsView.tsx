import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SystemStatus } from '../types';
import { api } from '../services/api';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ResetDemoButton } from '../components/ResetDemoButton';

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
          <h3>What is really connected</h3>
          <div className="sp" />
          <span className="prov">Checked live just now</span>
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
                    <td>AI (likely causes &amp; fix preview)</td>
                    <td><StatusPill ok={status.ai.configured} /></td>
                    <td className="mono">{status.ai.model} · {status.ai.location}</td>
                  </tr>
                  <tr>
                    <td>Data storage (BigQuery)</td>
                    <td><StatusPill ok={status.bigquery.configured} /></td>
                    <td className="mono">{status.bigquery.dataset}</td>
                  </tr>
                  <tr>
                    <td>Live alert feed (Pub/Sub)</td>
                    <td><StatusPill ok={status.pubsub.configured} /></td>
                    <td className="mono">{status.pubsub.topic ?? 'not set up'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <p className="prov">
            All machine numbers in this app are simulated. No real machine is connected.
          </p>
        </div>
      </section>

      <section className="panel">
        <header>
          <h3>Demo data</h3>
        </header>
        <div className="body" style={{ display: 'grid', gap: 10 }}>
          <p className="prov" style={{ margin: 0 }}>
            No account is needed: anyone who opens this page can work on the sample problems. After a problem has been fixed,
            restore them to run the whole flow again.
          </p>
          <div>
            <ResetDemoButton />
          </div>
        </div>
      </section>
    </div>
  );
}
