import { useNavigate } from 'react-router-dom';
import type { Alert, Incident, Machine, MachineStatus } from '../types';
import { formatTimestamp } from '../utils/time';
import { api } from '../services/api';

interface MachineTableProps {
  machines: Machine[];
  statuses: Map<string, MachineStatus>;
  // Accepted for backward compatibility with existing callers; no longer
  // used to resolve incidents (see openRow, which always looks up the
  // open incident directly rather than relying on in-memory alert state).
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

export default function MachineTable({ machines, statuses }: MachineTableProps) {
  const navigate = useNavigate();

  // Always check for an open incident on this machine, independent of its
  // current live status — a reading can drift back to normal while the
  // incident investigating it is still open (see Sidebar.openMachine).
  const openRow = async (m: Machine) => {
    try {
      const incidents = await api.getIncidentsByMachine(m.id);
      const open = (incidents ?? []).find((i: Incident) => i.status !== 'closed');
      if (open) {
        navigate(`/incident/${open.id}`);
        return;
      }
    } catch {
      // Fall through to the machine page if the lookup fails
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
              <tr key={m.id} className={rowClass(status)} onClick={() => openRow(m)}>
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
