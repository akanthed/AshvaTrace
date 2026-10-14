import { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import type { Incident } from '../types';
import { api } from '../services/api';
import { HypothesisList } from '../components/HypothesisList';
import { AuditLog } from '../components/AuditLog';

type TabKey = 'investigate' | 'actions' | 'verify' | 'audit';
const TAB_KEYS: TabKey[] = ['investigate', 'actions', 'verify', 'audit'];
const TAB_LABELS: Record<TabKey, string> = {
  investigate: 'Investigate',
  actions: 'Interventions',
  verify: 'Verify',
  audit: 'Audit',
};

function isTabKey(value: string | null): value is TabKey {
  return !!value && (TAB_KEYS as string[]).includes(value);
}

export function IncidentView() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [selectedHyp, setSelectedHyp] = useState<string | undefined>();
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);
  const [investigating, setInvestigating] = useState(false);
  const initialTab = searchParams.get('tab');
  const [tab, setTabState] = useState<TabKey>(isTabKey(initialTab) ? initialTab : 'investigate');
  const setTab = (next: TabKey) => {
    setTabState(next);
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('tab', next);
      return params;
    });
  };

  useEffect(() => {
    const paramTab = searchParams.get('tab');
    if (isTabKey(paramTab)) setTabState(paramTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id) return;
    api
      .getIncident(id)
      .then(setIncident)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="view">Loading incident…</div>;
  if (!incident) return <div className="view">Incident not found</div>;

  const handleInvestigate = async () => {
    setInvestigating(true);
    try {
      // Pull the machine's REAL current readings so the AI reasons over live
      // signal data instead of hardcoded constants.
      let signals: Record<string, number> = { power: incident.devPct };
      try {
        const status = await api.getMachineStatus(incident.machineId);
        signals = {
          power: incident.devPct,
          powerDevPct: status.devPct,
          actualPower: status.actual,
          expectedPower: status.expected,
          vibration: status.vibration,
          cycleTime: status.cycleTime,
        };
      } catch {
        // Fall back to deviation-only signals if status is unavailable
      }
      const result = await api.investigateIncident(incident.id, {
        machineId: incident.machineId,
        devPct: incident.devPct,
        signals,
      });
      setIncident(result);
    } catch (err) {
      console.error(err);
    } finally {
      setInvestigating(false);
    }
  };

  const handleSimulate = async () => {
    if (!selectedHyp) return;
    try {
      const result = await api.simulateAction(incident.id, {
        hypothesisId: selectedHyp,
        action: action || 'Replace worn component and recalibrate',
      });
      setIncident(result);
    } catch (err) {
      console.error(err);
    }
  };

  const handleVerify = async () => {
    try {
      // Send no explicit metrics — the server verifies against the machine's
      // REAL current readings, so the outcome reflects live state.
      const result = await api.verifyOutcome(incident.id, { actualMetrics: {} });
      setIncident(result);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="view">
      <div className="inc-head">
        <h1>{incident.id}</h1>
        <span className={`pill ${incident.severity}`}>{incident.severity}</span>
        <span className="pill info">{incident.status}</span>
        <div className="sp" />
        <Link to="/">← Home</Link>
      </div>

      <div className="tabs" role="tablist">
        {TAB_KEYS.map((k) => (
          <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
            {TAB_LABELS[k]}
          </button>
        ))}
      </div>

      <section className="panel">
        <header>
          <h3>
            {incident.machineName} — Deviation {incident.devPct}%
          </h3>
          <div className="sp" />
          <span className="prov">Detected: {new Date(incident.detectedAt).toLocaleString()}</span>
        </header>
        <div className="body" style={{ display: 'grid', gap: 16 }}>
          {tab === 'investigate' && (
            <>
              {incident.hypotheses.length === 0 && (
                <button className="primary" onClick={handleInvestigate} disabled={investigating} style={{ justifySelf: 'start' }}>
                  {investigating ? 'Asking AI for likely causes…' : 'Find likely causes'}
                </button>
              )}

              {incident.hypotheses.length > 0 && (
                <div>
                  <h4 style={{ margin: '0 0 8px' }}>Likely causes, ranked by AI</h4>
                  <HypothesisList
                    hypotheses={incident.hypotheses}
                    selectedId={selectedHyp}
                    onSelect={setSelectedHyp}
                  />
                </div>
              )}
            </>
          )}

          {tab === 'actions' && (
            <>
              {incident.hypotheses.length === 0 && (
                <div className="empty">
                  <b style={{ color: 'var(--fg)' }}>No hypothesis selected</b>
                  Run the investigation first, on the Investigate tab.
                </div>
              )}

              {incident.hypotheses.length > 0 && !selectedHyp && !incident.simulation && (
                <div className="empty">
                  <b style={{ color: 'var(--fg)' }}>No hypothesis selected</b>
                  Pick a likely cause on the Investigate tab before proposing a fix.
                </div>
              )}

              {selectedHyp && !incident.simulation && (
                <div>
                  <h4 style={{ margin: '0 0 8px' }}>What fix do you want to try?</h4>
                  <div className="assume" style={{ marginBottom: 10 }}>
                    <label>
                      Action
                      <input
                        type="text"
                        value={action}
                        onChange={(e) => setAction(e.target.value)}
                        placeholder="e.g. Replace worn component and recalibrate"
                      />
                    </label>
                  </div>
                  <button className="primary" onClick={handleSimulate}>
                    Preview what this fix should do
                  </button>
                </div>
              )}

              {incident.simulation && (
                <div className="panel">
                  <header>
                    <h3>What AI expects this fix to do</h3>
                  </header>
                  <div className="body">
                    <p style={{ margin: '0 0 6px' }}>{incident.simulation.predictedOutcome}</p>
                    <span className="prov">AI confidence: {incident.simulation.confidence}%</span>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'verify' && (
            <>
              {!incident.simulation && (
                <div className="empty">
                  <b style={{ color: 'var(--fg)' }}>No intervention to verify</b>
                  Propose and preview a fix on the Interventions tab first.
                </div>
              )}

              {incident.simulation && !incident.verification && (
                <button className="primary" onClick={handleVerify} style={{ justifySelf: 'start' }}>
                  Check if the fix actually worked
                </button>
              )}

              {incident.verification && (
                <div className="verdict">
                  <span className={`big ${incident.verification.passed ? '' : ''}`} style={{ color: incident.verification.passed ? 'var(--ok)' : 'var(--crit)' }}>
                    {incident.verification.passed ? 'PASS' : 'FAIL'}
                  </span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', marginBottom: 6 }}>{incident.verification.actualOutcome}</span>
                    <span className="mono prov">
                      {Object.entries(incident.verification.metrics).map(([k, v]) => (
                        <span key={k} style={{ marginRight: 14 }}>
                          {k}: {v}
                        </span>
                      ))}
                    </span>
                  </span>
                </div>
              )}
            </>
          )}

          {tab === 'audit' && <AuditLog entries={incident.auditLog} />}
        </div>
      </section>
    </div>
  );
}
