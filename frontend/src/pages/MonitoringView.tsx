import { useMachines } from '../hooks/useMachines';
import { useAlerts } from '../hooks/useAlerts';
import MachineTable from '../components/MachineTable';

interface Props {
  machineId?: string;
}

export default function MonitoringView({ machineId }: Props) {
  const { machines: allMachines, statuses, loading } = useMachines();
  const { alerts } = useAlerts();

  if (loading) {
    return <div className="loading">Loading monitoring data…</div>;
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
    </div>
  );
}
