import { useState } from 'react';
import { useMachines } from '../hooks/useMachines';
import { useAlerts } from '../hooks/useAlerts';
import MachineTable from '../components/MachineTable';
import { PlantManager } from '../components/PlantManager';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { api } from '../services/api';
import type { VisionInspection } from '../types';

interface Props {
  machineId?: string;
}

export default function MonitoringView({ machineId }: Props) {
  const { machines: allMachines, statuses, loading } = useMachines();
  const { alerts } = useAlerts();
  const [inspection, setInspection] = useState<VisionInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);

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

  return (
    <div className="home">
      {!machineId && (
        <div className="ph">
          <h1>Pune Plant</h1>
          <span>Shift A · 06:00–14:00 · {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
        </div>
      )}

      {!machineId && (
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
      )}

      {criticalAlert && (
        <div className="alarmrow">
          <div className="txt">
            <b>
              {criticalMachine?.name ?? criticalAlert.machineId} — {criticalAlert.message}
            </b>
            <small>
              {criticalAlert.timestamp} · {criticalAlert.machineId}
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

      {!machineId && (
        <PlantManager machines={allMachines} onChange={() => {}} />
      )}

      {machineId && (
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
      )}
    </div>
  );
}
