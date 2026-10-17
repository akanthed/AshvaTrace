import { useState, useEffect } from 'react';
import type { ShiftSummary, ThresholdViolation, CostImpact, TrackRecord } from '../types';
import { ReportCard } from '../components/ReportCard';
import { api } from '../services/api';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { formatTimestamp } from '../utils/time';

function fmtUsd(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toFixed(0)}`;
}

export function AnalyticsView() {
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [violations, setViolations] = useState<ThresholdViolation[]>([]);
  const [energy, setEnergy] = useState<any>(null);
  const [impact, setImpact] = useState<CostImpact | null>(null);
  const [record, setRecord] = useState<TrackRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [s, v, e, c, r] = await Promise.all([
          api.getShiftSummary(),
          api.getThresholdViolations(),
          api.getEnergyReport(),
          api.getCostImpact(),
          api.getTrackRecord(),
        ]);
        setRecord(r);
        setSummary(s);
        setViolations(v);
        setEnergy(e);
        setImpact(c);
      } catch {
        // API not available
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <LoadingSpinner label="Loading analytics…" />;

  return (
    <div className="view">
      {record && (
        <section className="panel">
          <header>
            <h3>AI report card — graded by code</h3>
            <div className="sp" />
            <span className="prov">How often the AI's advice held up when the machine was re-checked</span>
          </header>
          <div className="body">
            <ReportCard record={record} />
          </div>
        </section>
      )}

      {impact && (
        <section className="panel">
          <header>
            <h3>What problems cost — this shift</h3>
            <div className="sp" />
            <span className="prov">
              {impact.incidentsResolved}/{impact.incidentsTotal} problems solved
            </span>
          </header>
          <div className="body" style={{ display: 'grid', gap: 16 }}>
            <div className="counts">
              <div className="count">
                <small>Time off-normal</small>
                <b style={{ color: 'var(--crit)' }}>{impact.downtimeMinutes} min</b>
              </div>
              <div className="count">
                <small>Cost of that time</small>
                <b style={{ color: 'var(--crit)' }}>{fmtUsd(impact.downtimeCost)}</b>
              </div>
              <div className="count">
                <small>Extra energy used</small>
                <b style={{ color: 'var(--warn)' }}>{impact.energyWasteKwh} kWh</b>
              </div>
              <div className="count">
                <small>Avg time to resolve (AshvaTrace)</small>
                <b style={{ color: 'var(--ok)' }}>{impact.mttrMinutes} min</b>
              </div>
              <div className="count">
                <small>Avg time to resolve (industry)</small>
                <b>{impact.benchmarkMttrMinutes} min</b>
              </div>
              <div className="count">
                <small>Estimated savings</small>
                <b style={{ color: 'var(--ok)' }}>{fmtUsd(impact.totalSavings)}</b>
              </div>
              <div className="count">
                <small>AI running cost</small>
                <b>${impact.aiCostUsd.toFixed(2)}</b>
              </div>
            </div>
            <p className="prov" style={{ margin: 0 }}>
              Problems are solved {Math.abs(impact.mttrReductionPct)}% {impact.mttrReductionPct >= 0 ? 'faster' : 'slower'} than the industry average
              Downtime is valued at ${impact.assumptions.downtimeCostPerHour.toLocaleString()}/hr
              ({impact.assumptions.source}); industry benchmark from {impact.assumptions.benchmarkMttrSource}.
              This is demo data, so the figures are examples.
            </p>
          </div>
        </section>
      )}

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
                <small>Readings in 'Watch' range</small>
                <b style={{ color: 'var(--warn)' }}>{summary.totalWarnings}</b>
              </div>
              <div className="count">
                <small>Readings in 'Action required' range</small>
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
                    <th className="num">Avg vs normal</th>
                    <th className="num">Watch</th>
                    <th className="num">Action required</th>
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
                          {m.status === 'critical' ? 'Action required' : m.status === 'warning' ? 'Watch' : 'Normal'}
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
          <h3>Times a limit was crossed</h3>
          <div className="sp" />
          <span className="prov">{violations.length} total</span>
        </header>
        <div className="body">
          {violations.length === 0 ? (
            <p className="prov">No limits were crossed this shift.</p>
          ) : (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>Time</th>
                    <th className="num">Vs normal</th>
                    <th>Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {violations.slice(0, 20).map((v, i) => (
                    <tr key={i}>
                      <td>{v.machineName}</td>
                      <td className="mono">{formatTimestamp(v.timestamp)}</td>
                      <td className="num mono" style={{ color: v.severity === 'critical' ? 'var(--crit)' : 'var(--warn)' }}>
                        {v.devPct > 0 ? '+' : ''}
                        {v.devPct}%
                      </td>
                      <td>
                        <span className={`pill ${v.severity === 'critical' ? 'crit' : 'warn'}`}>{v.severity === 'critical' ? 'Action required' : 'Watch'}</span>
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
          <h3>Energy used</h3>
        </header>
        <div className="body">
          {energy && (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th className="num">Used (kWh)</th>
                    <th className="num">Normal (kWh)</th>
                    <th className="num">Extra (kWh)</th>
                    <th className="num">Extra %</th>
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
