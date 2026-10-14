import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { Incident, Machine, MachineSeries, MachineStatus, Thresholds } from '../types';
import { api, connectSSE } from '../services/api';
import { TrendsChart } from '../components/TrendsChart';
import { PlantManager } from '../components/PlantManager';
import { DashboardCanvas } from '../components/DashboardCanvas';
import { ThresholdPanel } from '../components/ThresholdPanel';
import MonitoringView from './MonitoringView';

type TabKey = 'monitoring' | 'dashboard' | 'threshold' | 'trends' | 'plant' | 'investigate' | 'actions' | 'verify' | 'audit';
type GroupKey = 'monitor' | 'investigate';

const GROUPS: Array<[GroupKey, string, Array<[TabKey, string]>]> = [
  [
    'monitor',
    'Monitor',
    [
      ['monitoring', 'Monitoring'],
      ['dashboard', 'Dashboard'],
      ['threshold', 'Threshold'],
      ['trends', 'Trends'],
      ['plant', 'Plant'],
    ],
  ],
  [
    'investigate',
    'Investigate & Verify',
    [
      ['investigate', 'Investigate'],
      ['actions', 'Actions'],
      ['verify', 'Verify'],
      ['audit', 'Audit'],
    ],
  ],
];

const TAB_KEYS = GROUPS.flatMap(([, , tabs]) => tabs.map(([k]) => k));

// Lucide-style SVG path data (24x24 viewBox, stroke-based) for each tab.
const TAB_ICONS: Record<TabKey, string> = {
  monitoring: 'M22 12h-4l-3 9L9 3l-3 9H2',
  dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  threshold: 'M12 20V10M18 20V4M6 20v-4',
  trends: 'M3 3v18h18M7 16l4-4 4 4 5-6',
  plant: 'M2 20h20M4 20V8l4-4 4 4v12M14 20V12l6-4v12',
  investigate: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  actions: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  verify: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3',
  audit: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
};

function isTabKey(value: string | null): value is TabKey {
  return !!value && (TAB_KEYS as string[]).includes(value);
}

function groupForTab(tab: TabKey): GroupKey {
  return GROUPS.find(([, , tabs]) => tabs.some(([k]) => k === tab))![0];
}

function statusLabel(status: string): string {
  if (status === 'critical') return 'Action required';
  if (status === 'warning') return 'Watch';
  return 'Normal';
}

function pillClass(status: string): string {
  if (status === 'critical') return 'crit';
  if (status === 'warning') return 'warn';
  return 'ok';
}

export function MachineView() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [machine, setMachine] = useState<Machine | null>(null);
  const [status, setStatus] = useState<MachineStatus | null>(null);
  const [series, setSeries] = useState<MachineSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const initialTab = searchParams.get('tab');
  const [tab, setTabState] = useState<TabKey>(isTabKey(initialTab) ? initialTab : 'monitoring');
  const [group, setGroup] = useState<GroupKey>(groupForTab(isTabKey(initialTab) ? initialTab : 'monitoring'));
  const setTab = (next: TabKey) => {
    setTabState(next);
    setGroup(groupForTab(next));
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('tab', next);
      return params;
    });
  };
  const [dashTiles, setDashTiles] = useState<string[]>(['power', 'deviation']);
  const [thresholds, setThresholds] = useState<Thresholds>({ upperAlarm: 10, upperWarning: 5, lowerWarning: -5, lowerAlarm: -10 });
  const [incident, setIncident] = useState<Incident | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const refreshMachines = () => api.getMachines().then(setMachines).catch(() => {});

  useEffect(() => {
    const paramTab = searchParams.get('tab');
    if (isTabKey(paramTab)) {
      setTabState(paramTab);
      setGroup(groupForTab(paramTab));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    refreshMachines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([api.getMachine(id), api.getMachineStatus(id), api.getMachineSeries(id), api.getIncidents()])
      .then(([m, s, ser, incidents]) => {
        setMachine(m);
        setStatus(s);
        setSeries(ser);
        setThresholds(m.thresholds);
        setIncident((incidents ?? []).find((i) => i.machineId === id && i.status !== 'closed') ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  // Live updates: when the server pushes a new sample, status, alert, or
  // incident update for this machine, reflect it immediately so the demo
  // shows the machine, its status, and its incident all changing in real time.
  useEffect(() => {
    if (!id) return;
    const disconnect = connectSSE((event: any) => {
      if (event.type === 'liveSample' && event.machineId === id) {
        if (event.status) setStatus(event.status);
        if (event.sample) {
          setSeries((prev) =>
            prev ? { ...prev, series: [...prev.series, event.sample] } : prev
          );
        }
      }
      if (event.type === 'incidentUpdated' && event.incident?.machineId === id) {
        setIncident(event.incident);
      }
    });
    return () => disconnect();
  }, [id]);

  if (loading) return <div className="view">Loading machine…</div>;
  if (!machine || !status) return <div className="view">Machine not found</div>;

  const dev = status.devPct;

  return (
    <div className="view">
      <div className="inc-head">
        <h1>{machine.name}</h1>
        <span className={`pill ${pillClass(status.status)}`}>{status.status}</span>
        <span className="pill ok" style={{ background: 'none', padding: 0, color: 'var(--muted)' }}>
          {statusLabel(status.status)}
        </span>
        <div className="kv">
          Machine
          <b>{machine.id}</b>
        </div>
        <div className="kv">
          Type
          <b>{machine.type}</b>
        </div>
        <div className="sp" />
        <Link to="/">← Home</Link>
      </div>

      <div className="tabs" role="tablist">
        {GROUPS.find(([k]) => k === group)![2].map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={TAB_ICONS[k]} />
            </svg>
            {label}
          </button>
        ))}
      </div>

      {tab === 'monitoring' && <MonitoringView machineId={machine.id} />}

      {tab === 'trends' && (
        <section className="panel">
          <header>
            <h3>Power Trends</h3>
            <div className="sp" />
            <span className="prov">What the machine used vs. what it should have used, updated live</span>
          </header>
          <div className="body" style={{ height: 320 }}>
            {series && (
              <TrendsChart
                series={series.series}
                machineId={machine.id}
                warningThreshold={thresholds.upperWarning}
                criticalThreshold={thresholds.upperAlarm}
              />
            )}
          </div>
        </section>
      )}

      {tab === 'dashboard' && (
        <section className="panel">
          <header>
            <h3>Dashboard · {machine.id}</h3>
            <div className="sp" />
            <span className="prov">Upload a blueprint or photo, then drag Active power onto it</span>
          </header>
          <DashboardCanvas machineId={machine.id} status={status} thresholds={thresholds} />
          <div className="body" style={{ display: 'grid', gap: 16 }}>
            {dashTiles.length ? (
              <div className="dash">
                {dashTiles.map((k) => (
                  <div className="dtile" key={k}>
                    <button className="rm" onClick={() => setDashTiles((t) => t.filter((x) => x !== k))}>
                      ✕
                    </button>
                    <span className="num" style={{ color: 'var(--muted)', fontSize: 12 }}>
                      {k === 'power' ? 'Active power' : 'Power deviation'}
                    </span>
                    <span className="val">{k === 'power' ? status.actual.toFixed(1) : `${dev > 0 ? '+' : ''}${dev.toFixed(1)}%`}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">
                <b style={{ color: 'var(--fg)' }}>No tiles yet</b>
                Nothing to show here yet.
              </div>
            )}
          </div>
        </section>
      )}

      {tab === 'threshold' && (
        <ThresholdPanel machineId={machine.id} thresholds={thresholds} onSaved={setThresholds} />
      )}

      {tab === 'plant' && <PlantManager machines={machines} onChange={refreshMachines} currentMachineId={machine.id} />}

      {(tab === 'investigate' || tab === 'actions' || tab === 'verify' || tab === 'audit') && (
        <section className="panel">
          <header>
            <h3>{tab === 'investigate' ? 'Investigate' : tab === 'actions' ? 'Interventions' : tab === 'verify' ? 'Verification' : 'Audit trail'}</h3>
          </header>
          <div className="body">
            {incident ? (
              <div className="empty">
                <b style={{ color: 'var(--fg)' }}>Incident {incident.id} open</b>
                Investigation, interventions, verification and audit trail for this machine live on its incident page.
                <div>
                  <Link className="primary" to={`/incident/${incident.id}?tab=${tab}`} style={{ textDecoration: 'none' }}>
                    Open incident
                  </Link>
                </div>
              </div>
            ) : (
              <div className="empty">
                <b style={{ color: 'var(--fg)' }}>No open incident</b>
                This tab populates once an incident is opened for {machine.id}.
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
