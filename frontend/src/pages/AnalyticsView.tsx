import { useState, useEffect } from 'react';
import type { ShiftSummary, ThresholdViolation } from '../types';
import { api } from '../services/api';

export function AnalyticsView() {
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [violations, setViolations] = useState<ThresholdViolation[]>([]);
  const [energy, setEnergy] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [s, v, e] = await Promise.all([
          api.getShiftSummary(),
          api.getThresholdViolations(),
          api.getEnergyReport(),
        ]);
        setSummary(s);
        setViolations(v);
        setEnergy(e);
      } catch {
        // API not available
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="view">Loading analytics…</div>;

  return (
    <div className="view">
      <section className="panel">
        <header>
          <h3>Shift summary</h3>
          <div className="sp" />
          <span className="prov">
            {summary?.shiftStart} – {summary?.shiftEnd}
          </span>
        </header>
        <div className="body" style={{ display: 'grid', gap: 16 }}>
          {summary && (
            <div className="counts">
              <div className="count">
                <small>Total warnings</small>
                <b style={{ color: 'var(--warn)' }}>{summary.totalWarnings}</b>
              </div>
              <div className="count">
                <small>Total criticals</small>
                <b style={{ color: 'var(--crit)' }}>{summary.totalCriticals}</b>
              </div>
              <div className="count">
                <small>Machines</small>
                <b>{summary.machines.length}</b>
              </div>
            </div>
          )}
          {summary && (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th className="num">Avg deviation</th>
                    <th className="num">Warnings</th>
                    <th className="num">Criticals</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.machines.map((m) => (
                    <tr key={m.machineId}>
                      <td>{m.name}</td>
                      <td className="num mono">{m.avgDevPct}%</td>
                      <td className="num mono" style={{ color: 'var(--warn)' }}>{m.warnings}</td>
                      <td className="num mono" style={{ color: 'var(--crit)' }}>{m.criticals}</td>
                      <td>
                        <span
                          className={`pill ${m.status === 'critical' ? 'crit' : m.status === 'warning' ? 'warn' : 'ok'}`}
                        >
                          {m.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <header>
          <h3>Threshold violations</h3>
          <div className="sp" />
          <span className="prov">{violations.length} total</span>
        </header>
        <div className="body">
          {violations.length === 0 ? (
            <p className="prov">No threshold violations this shift.</p>
          ) : (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>Time</th>
                    <th className="num">Deviation</th>
                    <th>Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {violations.slice(0, 20).map((v, i) => (
                    <tr key={i}>
                      <td>{v.machineName}</td>
                      <td className="mono">{v.timestamp}</td>
                      <td className="num mono" style={{ color: v.severity === 'critical' ? 'var(--crit)' : 'var(--warn)' }}>
                        {v.devPct > 0 ? '+' : ''}
                        {v.devPct}%
                      </td>
                      <td>
                        <span className={`pill ${v.severity === 'critical' ? 'crit' : 'warn'}`}>{v.severity}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <header>
          <h3>Energy report</h3>
        </header>
        <div className="body">
          {energy && (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th className="num">Actual (kWh)</th>
                    <th className="num">Expected (kWh)</th>
                    <th className="num">Excess (kWh)</th>
                    <th className="num">Excess %</th>
                  </tr>
                </thead>
                <tbody>
                  {energy.machines.map((m: any) => (
                    <tr key={m.machineId}>
                      <td>{m.name}</td>
                      <td className="num mono">{m.totalActualKwh}</td>
                      <td className="num mono">{m.totalExpectedKwh}</td>
                      <td className="num mono" style={{ color: m.excessKwh > 0 ? 'var(--warn)' : 'var(--ok)' }}>
                        {m.excessKwh > 0 ? '+' : ''}
                        {m.excessKwh}
                      </td>
                      <td className="num mono">{m.excessPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
