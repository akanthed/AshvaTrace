import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import type { Incident, MachineStatus, TrackRecord } from '../types';
import { api, connectSSE } from '../services/api';
import { HypothesisList } from '../components/HypothesisList';
import { AuditLog } from '../components/AuditLog';
import { InvestigationTrace } from '../components/InvestigationTrace';
import { VerifyPanel } from '../components/VerifyPanel';
import { LoadingSpinner } from '../components/LoadingSpinner';

const STATUS_LABELS: Record<Incident['status'], string> = {
  open: 'Open',
  investigating: 'AI investigating',
  action_taken: 'Fix being tried',
  verified: 'Fix verified',
  closed: 'Closed',
};

// Where the incident is in the investigate → fix → verify loop.
function progressStep(i: Incident): number {
  if (i.status === 'closed') return 4;
  if (i.verification?.passed) return 4;
  if (i.verification) return 3;
  if (i.simulation) return 3;
  if (i.hypotheses.length > 0) return 2;
  return 1;
}
const STEPS = ['Detected', 'Diagnosed', 'Fix tried', 'Verified'];

function devSentence(pct: number): string {
  const abs = Math.abs(pct);
  return `Power was ${abs}% ${pct >= 0 ? 'above' : 'below'} normal when this was detected`;
}

type TabKey = 'investigate' | 'actions' | 'verify' | 'audit';
const TAB_KEYS: TabKey[] = ['investigate', 'actions', 'verify', 'audit'];
const TAB_LABELS: Record<TabKey, string> = {
  investigate: 'Investigate',
  actions: 'Fix',
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [selectedHyp, setSelectedHyp] = useState<string | undefined>();
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);
  const [investigating, setInvestigating] = useState(false);
  const [investigateError, setInvestigateError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simulateError, setSimulateError] = useState<string | null>(null);
  const [resolutionComment, setResolutionComment] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [live, setLive] = useState<MachineStatus | null>(null);
  const [track, setTrack] = useState<TrackRecord | null>(null);
  const [allIncidents, setAllIncidents] = useState<Incident[]>([]);
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
    if (isTabKey(paramTab)) {
      setTabState(paramTab);
    } else {
      setTabState('investigate');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Live reading of this machine, for the "what is it wasting right now" banner,
  // plus the AI's track record on this machine.
  const machineId = incident?.machineId;
  const isOpenIncident = !!incident && incident.status !== 'closed' && incident.status !== 'verified';
  useEffect(() => {
    if (!machineId) return;
    api.getTrackRecord(machineId).then(setTrack).catch(() => {});
    if (!isOpenIncident) {
      setLive(null);
      return;
    }
    let stop = false;
    const load = () => api.getMachineStatus(machineId).then((s) => !stop && setLive(s)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [machineId, isOpenIncident]);

  // Live progress while the AI works, pushed by the server.
  useEffect(() => {
    if (!id) return;
    return connectSSE((event: any) => {
      if (event.type === 'investigationProgress' && event.incidentId === id) setProgressMsg(event.message);
    });
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setSelectedHyp(undefined);
    setAction('');
    api
      .getIncident(id)
      .then((inc) => {
        setIncident(inc);
        setRetrying(false);
        if (inc?.selectedHypothesis) setSelectedHyp(inc.selectedHypothesis);
        // Fetch all incidents for this machine so the user can see history
        if (inc) {
          api.getIncidentsByMachine(inc.machineId).then(setAllIncidents).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <LoadingSpinner label="Loading incident…" />;
  if (!incident) return <div className="view">Incident not found</div>;

  const handleInvestigate = async () => {
    setInvestigating(true);
    setProgressMsg(null);
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
        action: action || chosenHyp?.suggestedFix || 'Replace worn component and recalibrate',
      });
      setIncident(result);
      setRetrying(false);
    } catch (err: any) {
      setSimulateError(err.message || 'AI simulation failed');
    } finally {
      setSimulating(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      // Send no explicit metrics — the server verifies against the machine's
      // REAL current readings, so the outcome reflects live state.
      const result = await api.verifyOutcome(incident.id, { actualMetrics: {} });
      setIncident(result);
    } catch (err: any) {
      setVerifyError(err.message || 'Could not read the machine. Try again.');
    } finally {
      setVerifying(false);
    }
  };

  const chosenHyp = incident.hypotheses.find((h) => h.id === selectedHyp);
  const pickHypothesis = (hid: string) => {
    setSelectedHyp(hid);
    const h = incident.hypotheses.find((x) => x.id === hid);
    if (h?.suggestedFix) setAction(h.suggestedFix);
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!incident) return;
    setUpdatingStatus(true);
    setStatusError(null);
    try {
      const result = await api.updateIncidentStatus(incident.id, {
        status: newStatus,
        resolutionComment: resolutionComment || undefined,
      });
      setIncident(result);
      setResolutionComment('');
    } catch (err: any) {
      setStatusError(err.message || 'Failed to update status');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const STATUS_OPTIONS: Array<{ value: string; label: string; from: string[] }> = [
    { value: 'investigating', label: 'Mark as being investigated', from: ['open'] },
    { value: 'action_taken', label: 'Mark fix as applied', from: ['investigating'] },
    { value: 'verified', label: 'Mark fix as verified', from: ['action_taken'] },
    { value: 'closed', label: 'Close as resolved', from: ['open', 'investigating', 'action_taken', 'verified'] },
  ];
  const availableStatuses = STATUS_OPTIONS.filter((s) => s.from.includes(incident?.status ?? ''));

  return (
    <div className="view">
      <div className="inc-head">
        <h1>{incident.machineName}</h1>
        <span className={`pill ${incident.severity === 'critical' ? 'crit' : 'warn'}`}>
          {incident.severity === 'critical' ? 'Critical' : 'Warning'}
        </span>
        <span className="pill info">{STATUS_LABELS[incident.status]}</span>
        <span className="prov">Incident {incident.id}</span>
        <div className="sp" />
      </div>

      {isOpenIncident && live && live.actual - live.expected > 0.5 && (
        <div className="waste-banner">
          <b>Costing you right now:</b> this machine is using{' '}
          <span className="mono">{(live.actual - live.expected).toFixed(1)} kW</span> more than it should, about{' '}
          <span className="mono">${((live.actual - live.expected) * 16 * 0.12).toFixed(2)}/day</span> in wasted electricity
          (16 running hours, $0.12/kWh).
        </div>
      )}

      <ol className="stepper" aria-label="Incident progress">
        {STEPS.map((label, i) => {
          const cur = progressStep(incident);
          const state = i + 1 < cur ? 'done' : i + 1 === cur ? 'now' : 'todo';
          return (
            <li key={label} className={state}>
              <span className="dot">{state === 'done' ? '✓' : i + 1}</span>
              {label}
            </li>
          );
        })}
      </ol>

      {incident.status !== 'closed' && availableStatuses.length > 0 && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="body" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Update status:</span>
            <select
              value=""
              onChange={(e) => e.target.value && handleStatusChange(e.target.value)}
              disabled={updatingStatus}
              style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }}
            >
              <option value="" style={{ background: 'var(--panel)', color: 'var(--fg)' }}>Change status…</option>
              {availableStatuses.map((s) => (
                <option key={s.value} value={s.value} style={{ background: 'var(--panel)', color: 'var(--fg)' }}>{s.label}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Resolution comment (optional)"
              value={resolutionComment}
              onChange={(e) => setResolutionComment(e.target.value)}
              style={{ flex: 1, minWidth: 200, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }}
            />
            {statusError && <span style={{ color: 'var(--crit)', fontSize: 12 }}>{statusError}</span>}
          </div>
        </div>
      )}

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
          <h3>{devSentence(incident.devPct)}</h3>
          <div className="sp" />
          <span className="prov">Detected {new Date(incident.detectedAt).toLocaleString()}</span>
        </header>
        <div className="body" style={{ display: 'grid', gap: 16 }}>
          {tab === 'investigate' && (
            <>
              {/* All incidents on this machine — open + past, so the user sees history */}
              {allIncidents.length > 0 && (
                <div style={{ marginBottom: 16, display: 'grid', gap: 8 }}>
                  <h4 style={{ margin: 0, fontSize: 13, color: 'var(--muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Incidents on {incident.machineName}
                  </h4>
                  {allIncidents.map((inc) => {
                    const isOpen = inc.status === 'open' || inc.status === 'investigating' || inc.status === 'action_taken';
                    const isCurrent = inc.id === incident.id;
                    return (
                      <article
                        key={inc.id}
                        className="hyp"
                        onClick={() => !isCurrent && navigate(`/incident/${inc.id}?tab=investigate`)}
                        style={{
                          opacity: isCurrent ? 1 : 0.75,
                          borderLeft: isCurrent ? '3px solid var(--accent)' : '3px solid transparent',
                          cursor: isCurrent ? 'default' : 'pointer',
                        }}
                      >
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
                        {/* For resolved incidents, show what was done and if it worked */}
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
                                {inc.verification.passed ? '✓ Verified — fix worked' : '✗ Fix did not work'}
                              </span>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}

              {incident.hypotheses.length === 0 && (
                <div style={{ display: 'grid', gap: 10, justifyItems: 'start' }}>
                  <div className="ask-card">
                    <h4>Find out why {incident.machineName} is drawing {Math.abs(incident.devPct)}% {incident.devPct >= 0 ? 'extra' : 'less'} power</h4>
                    <ul className="ask-steps">
                      <li>The AI reads this machine's live power, vibration and part-time readings</li>
                      <li>It checks the plant's procedures (SOPs) and past incidents on this machine</li>
                      <li>A second AI pass reviews the answer, then code verifies every number it quotes</li>
                    </ul>
                    <button className="primary" onClick={handleInvestigate} disabled={investigating} style={{ padding: '10px 20px', fontSize: 14 }}>
                      {investigating ? 'Reading the machine data…' : investigateError ? 'Try again' : 'Ask AI'}
                    </button>
                    {investigating && <span className="prov">{progressMsg ?? 'Starting…'} · usually about 10 seconds</span>}
                  </div>
                  {investigateError && (
                    <div className="empty" style={{ borderColor: 'var(--crit)' }}>
                      <b style={{ color: 'var(--crit)' }}>The AI could not finish</b>
                      Nothing was made up. Please try again. ({investigateError})
                    </div>
                  )}
                </div>
              )}

              {incident.hypotheses.length > 0 && (
                <div>
                  {track && track.graded > 0 && (
                    <p className="track-line">
                      <b>AI track record on {incident.machineName}:</b> {track.fixesPassed} of {track.graded} past fixes passed the code check.
                      {track.predictionsScored > 0 && ` Its own predictions came true ${track.predictionsHeld} of ${track.predictionsScored} times.`}
                    </p>
                  )}
                  <h4 style={{ margin: '0 0 4px' }}>Likely causes, most likely first</h4>
                  <p className="prov" style={{ margin: '0 0 10px' }}>
                    Pick the one you believe. Then open the Fix tab to try a repair.
                  </p>
                  {incident.investigationTrace && incident.investigationTrace.length > 0 && (
                    <InvestigationTrace trace={incident.investigationTrace} />
                  )}
                  <HypothesisList
                    hypotheses={incident.hypotheses}
                    selectedId={selectedHyp}
                    onSelect={pickHypothesis}
                  />
                  <div className="next-bar">
                    <button className="primary" onClick={() => setTab('actions')} disabled={!selectedHyp}>
                      {selectedHyp ? 'Next: choose a fix →' : 'Select a cause to continue'}
                    </button>
                    {incident.aiCostUsd > 0 && (
                      <span className="prov">AI cost so far: ${incident.aiCostUsd.toFixed(4)}</span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'actions' && (
            <>
              {incident.hypotheses.length === 0 && (
                <div className="empty">
                  <b style={{ color: 'var(--fg)' }}>Nothing to fix yet</b>
                  Ask the AI for likely causes on the Investigate tab first.
                  <button className="primary" style={{ justifySelf: 'start' }} onClick={() => setTab('investigate')}>
                    Go to Investigate
                  </button>
                </div>
              )}

              {incident.hypotheses.length > 0 && !selectedHyp && !incident.simulation && (
                <div className="empty">
                  <b style={{ color: 'var(--fg)' }}>Choose a cause first</b>
                  Pick the cause you believe on the Investigate tab, then come back to choose a fix.
                  <button className="primary" style={{ justifySelf: 'start' }} onClick={() => setTab('investigate')}>
                    Go to Investigate
                  </button>
                </div>
              )}

              {chosenHyp && (!incident.simulation || retrying) && (
                <div className="fix-form">
                  <div className="cause-chip">
                    <span>Cause you picked</span>
                    <b>{chosenHyp.title}</b>
                  </div>
                  <h4 style={{ margin: '4px 0 8px' }}>What fix do you want to try?</h4>
                  <div className="assume" style={{ marginBottom: 6 }}>
                    <label>
                      Fix to try
                      <input
                        type="text"
                        value={action}
                        onChange={(e) => setAction(e.target.value)}
                        placeholder="e.g. Replace worn component and recalibrate"
                      />
                    </label>
                  </div>
                  {chosenHyp.suggestedFix && action !== chosenHyp.suggestedFix && (
                    <button type="button" className="linkbtn" onClick={() => setAction(chosenHyp.suggestedFix!)}>
                      Use the AI's suggestion: “{chosenHyp.suggestedFix}”
                    </button>
                  )}
                  <div style={{ marginTop: 10 }}>
                    <button className="primary" onClick={handleSimulate} disabled={simulating}>
                      {simulating ? 'AI is predicting the result…' : simulateError ? 'Try again' : 'See what this fix should do'}
                    </button>
                  </div>
                  <p className="prov" style={{ marginTop: 8 }}>
                    This is a simulation — nothing is sent to the machine. The AI commits to a number now; the code checks it later.
                  </p>
                  {simulateError && (
                    <div className="empty" style={{ borderColor: 'var(--crit)', marginTop: 10 }}>
                      <b style={{ color: 'var(--crit)' }}>The AI could not finish</b>
                      {simulateError}
                    </div>
                  )}
                </div>
              )}

              {incident.simulation && !retrying && (
                <div className="predict">
                  <div className="predict-head">
                    <span className="prov">The fix you chose</span>
                    <b>{incident.simulation.action}</b>
                  </div>
                  <p className="predict-text">{incident.simulation.predictedOutcome}</p>
                  <div className="predict-stats">
                    {incident.simulation.baseline && (
                      <div>
                        <small>Power vs normal today</small>
                        <b className="mono">{incident.simulation.baseline.powerDevPct}%</b>
                      </div>
                    )}
                    {incident.simulation.expectedPowerDevPct !== undefined && (
                      <div>
                        <small>AI expects after the fix</small>
                        <b className="mono">{incident.simulation.expectedPowerDevPct}%</b>
                      </div>
                    )}
                    <div>
                      <small>AI is this sure</small>
                      <b className="mono">{incident.simulation.confidence}%</b>
                    </div>
                  </div>
                  <div className="next-bar">
                    <button className="primary" onClick={() => setTab('verify')}>
                      Next: check if it worked →
                    </button>
                    <button type="button" className="linkbtn" onClick={() => setRetrying(true)}>
                      Choose a different fix
                    </button>
                    {incident.aiCostUsd > 0 && <span className="prov">AI cost so far: ${incident.aiCostUsd.toFixed(4)}</span>}
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'verify' && (
            <>
              {!incident.simulation && (
                <div className="empty">
                  <b style={{ color: 'var(--fg)' }}>No fix to check yet</b>
                  Choose and preview a fix on the Fix tab first.
                  <button className="primary" style={{ justifySelf: 'start' }} onClick={() => setTab('actions')}>
                    Go to Fix
                  </button>
                </div>
              )}

              {incident.simulation && !incident.verification && (
                <div className="verify-start">
                  <h4>Did the fix work?</h4>
                  <p>
                    Once the fix has been done on the machine, press the button. Code (not AI) reads the machine's live power, vibration and
                    part time and compares each one with its limit.
                  </p>
                  <button className="primary" onClick={handleVerify} disabled={verifying}>
                    {verifying ? 'Reading the machine…' : 'Check the machine now'}
                  </button>
                  {verifyError && <span style={{ color: 'var(--crit)', fontSize: 13 }}>{verifyError}</span>}
                </div>
              )}

              {incident.simulation && incident.verification && (
                <VerifyPanel
                  verification={incident.verification}
                  simulation={incident.simulation}
                  canClose={incident.status !== 'closed'}
                  onClose={() => handleStatusChange('closed')}
                  onRetry={() => {
                    setRetrying(true);
                    setTab('actions');
                  }}
                />
              )}
            </>
          )}

          {tab === 'audit' && <AuditLog entries={incident.auditLog} />}
        </div>
      </section>
    </div>
  );
}
