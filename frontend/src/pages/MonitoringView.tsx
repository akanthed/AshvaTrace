import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMachines } from '../hooks/useMachines';
import { useAlerts } from '../hooks/useAlerts';
import MachineTable from '../components/MachineTable';
import { PlantManager } from '../components/PlantManager';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { api } from '../services/api';
import { formatTimestamp } from '../utils/time';
import type { Machine, MachineStatus, VisionInspection } from '../types';

interface Props {
  machineId?: string;
}

type PlantTabKey = 'monitoring' | 'dashboard' | 'threshold' | 'trends' | 'plant';

const PLANT_TABS: Array<[PlantTabKey, string, string]> = [
  ['monitoring', 'Monitoring', 'M22 12h-4l-3 9L9 3l-3 9H2'],
  ['dashboard', 'Dashboard', 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z'],
  ['threshold', 'Threshold', 'M12 20V10M18 20V4M6 20v-4'],
  ['trends', 'Trends', 'M3 3v18h18M7 16l4-4 4 4 5-6'],
  ['plant', 'Plant', 'M2 20h20M4 20V8l4-4 4 4v12M14 20V12l6-4v12'],
];

function isPlantTabKey(value: string | null): value is PlantTabKey {
  return !!value && PLANT_TABS.some(([k]) => k === value);
}

// Machine isn't picked yet for a per-machine tab — list machines to drill into.
function MachinePicker({ machines, statuses, tab }: { machines: Machine[]; statuses: Map<string, MachineStatus>; tab: PlantTabKey }) {
  const navigate = useNavigate();
  return (
    <div className="panel">
      <header>
        <h3>Pick a machine</h3>
        <span className="prov">{PLANT_TABS.find(([k]) => k === tab)?.[1]} is per-machine — choose one</span>
      </header>
      <div className="tbl-wrap">
        <table className="mtable">
          <tbody>
            {machines.map((m) => (
              <tr key={m.id} onClick={() => navigate(`/machine/${m.id}?tab=${tab}`)}>
                <td>
                  <b>{m.id}</b>
                  <br />
                  <small>{m.name}</small>
                </td>
                <td>{statuses.get(m.id)?.status ?? 'normal'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MonitoringView({ machineId }: Props) {
  const { machines: allMachines, statuses, loading, refresh: refreshMachines } = useMachines();
  const { alerts } = useAlerts();
  const [inspection, setInspection] = useState<VisionInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialPlantTab = searchParams.get('tab');
  const [plantTab, setPlantTabState] = useState<PlantTabKey>(isPlantTabKey(initialPlantTab) ? initialPlantTab : 'monitoring');
  const setPlantTab = (next: PlantTabKey) => {
    setPlantTabState(next);
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('tab', next);
      return params;
    });
  };

  async function runInspection() {
    if (!machineId) return;
    setInspecting(true);
    try {
      const result = await api.inspectTool(machineId);
      setInspection(result);
    } catch {
      setInspection(null);
    } finally {
      setInspecting(false);
    }
  }

  if (loading) {
    return <LoadingSpinner label="Loading monitoring data…" />;
  }

  const machines = machineId ? allMachines.filter((m) => m.id === machineId) : allMachines;

  const critical = machines.filter((m) => statuses.get(m.id)?.status === 'critical').length;
  const warning = machines.filter((m) => statuses.get(m.id)?.status === 'warning').length;
  const normal = machines.filter((m) => statuses.get(m.id)?.status === 'normal').length;
  const excess = machines.filter((m) => (statuses.get(m.id)?.devPct ?? 0) > 5).length;

  const criticalAlert = alerts.find((a) => a.severity === 'critical' && (!machineId || a.machineId === machineId));
  const criticalMachine = criticalAlert
    ? machines.find((m) => m.id === criticalAlert.machineId)
    : undefined;
  // The alert's message/devPct are frozen at the moment it fired; show the
  // machine's current live deviation instead so the banner matches the table.
  const criticalLiveDev = criticalAlert ? statuses.get(criticalAlert.machineId)?.devPct : undefined;
  const criticalMessage = criticalAlert && criticalLiveDev !== undefined
    ? `CRITICAL: ${criticalMachine?.name ?? criticalAlert.machineId} power deviation ${criticalLiveDev}% exceeds critical threshold`
    : criticalAlert?.message;

  // Top-level /monitoring route (no machineId prop): plant-wide tabs. The
  // Monitoring tab shows the all-machines table; the other tabs are
  // per-machine, so show a picker that drills into /machine/:id?tab=....
  if (!machineId) {
    return (
      <div className="home">
        <div className="ph">
          <h1>Pune Plant</h1>
          <span>Shift A · 06:00–14:00 · {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
        </div>

        <div className="tabs" role="tablist">
          {PLANT_TABS.map(([k, label, icon]) => (
            <button key={k} className={`tab ${plantTab === k ? 'on' : ''}`} onClick={() => setPlantTab(k)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={icon} />
              </svg>
              {label}
            </button>
          ))}
        </div>

        {plantTab === 'monitoring' && (
          <>
            <div className="counts">
              <div className="count">
                <small>Action required</small>
                <b>{critical}</b>
              </div>
              <div className="count">
                <small>Watch</small>
                <b>{warning}</b>
              </div>
              <div className="count">
                <small>Normal</small>
                <b>{normal}</b>
              </div>
              <div className="count">
                <small>Excess energy</small>
                <b>{excess}</b>
              </div>
            </div>

            {criticalAlert && (
              <div className="alarmrow">
                <div className="txt">
                  <b>
                    {criticalMachine?.name ?? criticalAlert.machineId} — {criticalMessage}
                  </b>
                  <small>
                    {formatTimestamp(criticalAlert.timestamp)} · {criticalAlert.machineId}
                  </small>
                </div>
                <a
                  className="primary"
                  href={`/incident/${criticalAlert.incidentId ?? criticalAlert.id}`}
                  style={{ textDecoration: 'none' }}
                >
                  Open incident
                </a>
              </div>
            )}

            <div className="panel">
              <header>
                <h3>Monitoring</h3>
                <div className="sp" />
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                  {machines.length} machine{machines.length === 1 ? '' : 's'} · {critical} critical · {warning} warning · {normal} normal
                </span>
              </header>
              <div className="body">
                <MachineTable machines={machines} statuses={statuses} alerts={alerts} />
              </div>
            </div>
          </>
        )}

        {plantTab === 'plant' && <PlantManager machines={allMachines} onChange={refreshMachines} />}

        {(plantTab === 'dashboard' || plantTab === 'threshold' || plantTab === 'trends') && (
          <MachinePicker machines={allMachines} statuses={statuses} tab={plantTab} />
        )}
      </div>
    );
  }

  return (
    <div className="home">
      {criticalAlert && (
        <div className="alarmrow">
          <div className="txt">
            <b>
              {criticalMachine?.name ?? criticalAlert.machineId} — {criticalMessage}
            </b>
            <small>
              {formatTimestamp(criticalAlert.timestamp)} · {criticalAlert.machineId}
            </small>
          </div>
          <a
            className="primary"
            href={`/incident/${criticalAlert.incidentId ?? criticalAlert.id}`}
            style={{ textDecoration: 'none' }}
          >
            Open incident
          </a>
        </div>
      )}

      <div className="panel">
        <header>
          <h3>Monitoring</h3>
        </header>
        <div className="body">
          <MachineTable machines={machines} statuses={statuses} alerts={alerts} />
        </div>
      </div>

      <div className="panel">
        <header>
          <h3>Tool Inspection (Vision AI)</h3>
          <div className="sp" />
          <button className="primary" onClick={runInspection} disabled={inspecting}>
            {inspecting ? 'Analyzing…' : 'Run Inspection'}
          </button>
        </header>
        <div className="body">
          {inspecting && <LoadingSpinner label="Running Vision AI analysis on tool image…" full={false} />}
          {!inspecting && !inspection && (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              Run a Vision AI inspection to analyze the machine's cutting tool condition from a synthetic inspection image.
            </p>
          )}
          {inspection && (
            <div>
              <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                <div className="count">
                  <small>Condition</small>
                  <b style={{ color: inspection.condition === 'good' ? 'var(--ok)' : inspection.condition === 'worn' ? 'var(--warn)' : 'var(--crit)' }}>
                    {inspection.condition.toUpperCase()}
                  </b>
                </div>
                <div className="count">
                  <small>Wear</small>
                  <b>{inspection.wearPct}%</b>
                </div>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                <strong>Observations:</strong>
                <ul style={{ margin: '4px 0 8px 16px' }}>
                  {inspection.observations.map((o, i) => <li key={i}>{o}</li>)}
                </ul>
                <strong>Recommendation:</strong> {inspection.recommendation}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
