import { useNavigate } from 'react-router-dom';
import type { Alert, Machine, MachineStatus } from '../types';
import { formatTimestamp } from '../utils/time';

interface MachineTableProps {
  machines: Machine[];
  statuses: Map<string, MachineStatus>;
  alerts?: Alert[];
}

function statusToSt(status: string): 'ok' | 'warn' | 'crit' {
  if (status === 'critical') return 'crit';
  if (status === 'warning') return 'warn';
  return 'ok';
}

function statusLabel(status: string): string {
  if (status === 'critical') return 'Upper alarm';
  if (status === 'warning') return 'Upper warning';
  return 'Normal';
}

function rowClass(status: string): string {
  if (status === 'critical') return 'row-crit';
  if (status === 'warning') return 'row-warn';
  return '';
}

export default function MachineTable({ machines, statuses, alerts = [] }: MachineTableProps) {
  const navigate = useNavigate();

  const openRow = (m: Machine, status: string) => {
    if (status === 'critical' || status === 'warning') {
      const alert = alerts.find((a) => a.machineId === m.id && !a.acknowledged);
      if (alert?.incidentId) {
        navigate(`/incident/${alert.incidentId}`);
        return;
      }
      navigate(`/machine/${m.id}?tab=investigate`);
      return;
    }
    navigate(`/machine/${m.id}?tab=monitoring`);
  };

  return (
    <div className="tbl-wrap">
      <table className="mtable">
        <thead>
          <tr>
            <th>Source</th>
            <th className="num">Value</th>
            <th>Unit</th>
            <th className="num">Deviation</th>
            <th>Status</th>
            <th>Last update</th>
          </tr>
        </thead>
        <tbody>
          {machines.map((m) => {
            const st = statuses.get(m.id);
            const status = st?.status ?? 'normal';
            const stClass = statusToSt(status);
            const dev = st?.devPct ?? 0;

            return (
              <tr key={m.id} className={rowClass(status)} onClick={() => openRow(m, status)}>
                <td>
                  <b>{m.id}</b>
                  <br />
                  <small>{m.name}</small>
                </td>
                <td className="num mono">{st ? st.actual.toFixed(1) : '—'}</td>
                <td>kW</td>
                <td className="num mono">
                  {dev > 0 ? '+' : ''}
                  {dev.toFixed(1)}%
                </td>
                <td>
                  <span className="stc">
                    <span className={`st ${stClass}`} />
                    <span>{statusLabel(status)}</span>
                  </span>
                </td>
                <td className="mono">{formatTimestamp(st?.timestamp)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
