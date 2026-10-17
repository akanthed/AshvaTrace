import type { TrackRecord } from '../types';

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${Math.round((n / d) * 100)}%`;
}

// The AI's report card. Every figure is produced by code from verify() results,
// so the AI is graded on outcomes it cannot influence.
export function ReportCard({ record }: { record: TrackRecord }) {
  if (record.graded === 0) {
    return (
      <div className="empty">
        <b style={{ color: 'var(--fg)' }}>No graded fixes yet</b>
        Once an engineer tries a fix and the code checks it, the AI is scored here.
      </div>
    );
  }

  return (
    <div className="rcard">
      <div className="counts">
        <div className="count">
          <small>Fixes that passed the code check</small>
          <b style={{ color: 'var(--ok)' }}>
            {record.fixesPassed} of {record.graded}
          </b>
        </div>
        <div className="count">
          <small>Top-ranked cause was right</small>
          <b>{record.topCauseChosen ? pct(record.topCausePassed, record.topCauseChosen) : '—'}</b>
        </div>
        <div className="count">
          <small>AI's own prediction came true</small>
          <b>{record.predictionsScored ? `${record.predictionsHeld} of ${record.predictionsScored}` : '—'}</b>
        </div>
        <div className="count">
          <small>Average prediction miss</small>
          <b>{record.avgPredictionErrorPts === null ? '—' : `${record.avgPredictionErrorPts} pts`}</b>
        </div>
      </div>

      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>When the AI said…</th>
              <th className="num">Fixes tried</th>
              <th className="num">Passed</th>
              <th className="num">Real pass rate</th>
            </tr>
          </thead>
          <tbody>
            {record.calibration.map((b) => (
              <tr key={b.label}>
                <td>{b.label}</td>
                <td className="num mono">{b.incidents}</td>
                <td className="num mono">{b.passed}</td>
                <td className="num mono">{pct(b.passed, b.incidents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="prov" style={{ margin: 0 }}>
        Graded by code, not by the AI. If "70%+ sure" fixes pass far less than 70% of the time, the AI is overconfident, and this table shows it.
      </p>
    </div>
  );
}
