import type { Incident } from '../types';

type Verification = NonNullable<Incident['verification']>;
type Simulation = NonNullable<Incident['simulation']>;

const METRIC_KEYS: Record<string, string> = {
  'Power draw vs normal': 'powerDevPct',
  Vibration: 'vibrationMmS',
  'Time per part': 'cycleTimeSec',
};

function fmt(n: number | undefined, unit: string): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return `${n}${unit === '%' ? '%' : ` ${unit}`}`;
}

// Deterministic result card: every check is plain arithmetic on live readings.
// Shows before → after against the limit, and scores the AI's own prediction.
export function VerifyPanel({
  verification,
  simulation,
  canClose,
  onClose,
  onRetry,
}: {
  verification: Verification;
  simulation: Simulation;
  canClose: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  const v = verification;
  const baseline = v.baseline ?? simulation.baseline;
  const checks = v.checks ?? [];

  return (
    <div className="verify">
      <div className={`verdict ${v.passed ? 'pass' : 'fail'}`}>
        <span className="big">{v.passed ? 'PASS' : 'FAIL'}</span>
        <span className="verdict-text">
          <b>{v.passed ? 'The fix worked.' : 'The fix did not hold.'}</b>
          <span>{v.actualOutcome}</span>
        </span>
      </div>

      {checks.length > 0 && (
        <div className="tbl-wrap">
          <table className="vtable">
            <thead>
              <tr>
                <th>Reading</th>
                <th className="num">Before fix</th>
                <th className="num">Now</th>
                <th>Must be</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.label}>
                  <td>{c.label}</td>
                  <td className="num mono">{fmt(baseline?.[METRIC_KEYS[c.label]], c.unit)}</td>
                  <td className="num mono">
                    <b>{fmt(c.actual, c.unit)}</b>
                  </td>
                  <td className="muted">{c.limit}</td>
                  <td>
                    <span className={`pill ${c.passed ? 'ok' : 'crit'}`}>{c.passed ? '✓ OK' : '✗ Out of range'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {v.expectedPowerDevPct !== undefined && v.predictionHeld !== undefined && (
        <div className={`predcheck ${v.predictionHeld ? 'held' : 'missed'}`}>
          <b>AI prediction vs reality</b>
          <span>
            AI expected power to settle near <b className="mono">{v.expectedPowerDevPct}%</b>. Measured{' '}
            <b className="mono">{v.metrics.powerDevPct}%</b> —{' '}
            {v.predictionHeld ? 'the prediction held (within 3 points).' : 'the prediction was off by more than 3 points.'}
          </span>
        </div>
      )}

      {v.passed && v.savings && (
        <div className="savings">
          <b>What this fix saves</b>
          <div className="savings-stats">
            <div>
              <small>Power no longer wasted</small>
              <strong className="mono">{v.savings.kw} kW</strong>
            </div>
            <div>
              <small>Energy cost saved</small>
              <strong className="mono">${v.savings.usdPerDay}/day</strong>
            </div>
            <div>
              <small>CO₂ avoided</small>
              <strong className="mono">{v.savings.kgCo2PerMonth} kg/month</strong>
            </div>
          </div>
          <span className="prov">Assumes {v.savings.assumptions}. Calculated by code from the before and after readings.</span>
        </div>
      )}

      {v.simulatedEffect && (
        <p className="prov verify-note">
          Demo note: this is a simulated machine.{' '}
          {v.simulatedEffect === 'recovered'
            ? "You picked the AI's top-ranked cause, so the simulated machine recovered after the fix."
            : 'You picked a cause the AI ranked lower, so the simulated machine did not change.'}
        </p>
      )}

      <p className="prov verify-note">
        This verdict is plain arithmetic on live machine readings — no AI involved. The AI proposes; the code decides.
      </p>

      <div className="verify-actions">
        {v.passed && canClose && (
          <button className="primary" onClick={onClose}>
            Close incident as resolved
          </button>
        )}
        {!v.passed && (
          <button className="primary" onClick={onRetry}>
            Try a different fix
          </button>
        )}
      </div>
    </div>
  );
}
