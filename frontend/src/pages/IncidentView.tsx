import { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import type { Incident } from '../types';
import { api } from '../services/api';
import { HypothesisList } from '../components/HypothesisList';
import { AuditLog } from '../components/AuditLog';
import { InvestigationTrace } from '../components/InvestigationTrace';
import { LoadingSpinner } from '../components/LoadingSpinner';

type TabKey = 'investigate' | 'actions' | 'verify' | 'audit';
const TAB_KEYS: TabKey[] = ['investigate', 'actions', 'verify', 'audit'];
const TAB_LABELS: Record<TabKey, string> = {
  investigate: 'Investigate',
  actions: 'Interventions',
  verify: 'Verify',
  audit: 'Audit',
};

const TAB_ICONS: Record<TabKey, string> = {
  investigate: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  actions: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  verify: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3',
  audit: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
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
  const [investigateError, setInvestigateError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simulateError, setSimulateError] = useState<string | null>(null);
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

  if (loading) return <LoadingSpinner label="Loading incident…" />;
  if (!incident) return <div className="view">Incident not found</div>;

  const handleInvestigate = async () => {
    setInvestigating(true);
    setInvestigateError(null);
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
    } catch (err: any) {
      // The AI call failed — show the failure honestly rather than ever
      // substituting canned hypotheses, which would be indistinguishable
      // from a real (if mediocre) AI result.
      setInvestigateError(err.message || 'AI investigation failed');
    } finally {
      setInvestigating(false);
    }
  };

  const handleSimulate = async () => {
    if (!selectedHyp) return;
    setSimulating(true);
    setSimulateError(null);
    try {
      const result = await api.simulateAction(incident.id, {
        hypothesisId: selectedHyp,
        action: action || 'Replace worn component and recalibrate',
      });
      setIncident(result);
    } catch (err: any) {
      setSimulateError(err.message || 'AI simulation failed');
    } finally {
      setSimulating(false);
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={TAB_ICONS[k]} />
            </svg>
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
                <div style={{ display: 'grid', gap: 10, justifyItems: 'start' }}>
                  <button className="primary" onClick={handleInvestigate} disabled={investigating} style={{ justifySelf: 'start' }}>
                    {investigating ? 'Asking AI for likely causes…' : investigateError ? 'Retry investigation' : 'Find likely causes'}
                  </button>
                  {investigateError && (
                    <div className="empty" style={{ borderColor: 'var(--crit)' }}>
                      <b style={{ color: 'var(--crit)' }}>AI investigation failed</b>
                      {investigateError}
                    </div>
                  )}
                </div>
              )}

              {incident.hypotheses.length > 0 && (
                <div>
                  <h4 style={{ margin: '0 0 8px' }}>Likely causes, ranked by AI</h4>
                  {incident.investigationTrace && incident.investigationTrace.length > 0 && (
                    <InvestigationTrace trace={incident.investigationTrace} />
                  )}
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
                  <button className="primary" onClick={handleSimulate} disabled={simulating}>
                    {simulating ? 'Asking AI…' : simulateError ? 'Retry' : 'Preview what this fix should do'}
                  </button>
                  {simulateError && (
                    <div className="empty" style={{ borderColor: 'var(--crit)', marginTop: 10 }}>
                      <b style={{ color: 'var(--crit)' }}>AI simulation failed</b>
                      {simulateError}
                    </div>
                  )}
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
