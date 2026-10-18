import { useState } from 'react';
import type { Thresholds } from '../types';
import { api } from '../services/api';

interface Props {
  machineId: string;
  thresholds: Thresholds;
  onSaved: (next: Thresholds) => void;
}

type FieldKey = keyof Thresholds;

const ROWS: Array<[FieldKey, string]> = [
  ['upperAlarm', 'Action required — too high'],
  ['upperWarning', 'Watch — too high'],
  ['lowerWarning', 'Watch — too low'],
  ['lowerAlarm', 'Action required — too low'],
];

export function ThresholdPanel({ machineId, thresholds, onSaved }: Props) {
  // Raw text per field, so partial input like "-" or "" can be typed
  // without being coerced to a number mid-edit.
  const [text, setText] = useState<Record<FieldKey, string>>(() => ({
    upperAlarm: String(thresholds.upperAlarm),
    upperWarning: String(thresholds.upperWarning),
    lowerWarning: String(thresholds.lowerWarning),
    lowerAlarm: String(thresholds.lowerAlarm),
  }));
  const form = Object.fromEntries(ROWS.map(([k]) => [k, Number(text[k])])) as Thresholds;
  const valid = ROWS.every(([k]) => text[k].trim() !== '' && Number.isFinite(form[k]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = valid && ROWS.some(([key]) => form[key] !== thresholds[key]);

  const handleSave = async () => {
    setError(null);
    if (!valid) {
      setError('Enter a number for every limit');
      return;
    }
    if (form.upperAlarm < form.upperWarning) {
      setError("The 'Action required' high limit must be at least as high as the 'Watch' high limit");
      return;
    }
    if (form.lowerAlarm > form.lowerWarning) {
      setError("The 'Action required' low limit must be at or below the 'Watch' low limit");
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateMachine(machineId, { thresholds: form });
      onSaved(updated.thresholds);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the limits');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel">
      <header>
        <h3>Limits · {machineId}</h3>
        <div className="sp" />
        <span className="prov">How far from normal power can go before the status changes</span>
      </header>
      <div className="body" style={{ display: 'grid', gap: 16 }}>
        {error && <div className="prov" style={{ color: 'var(--crit)' }}>{error}</div>}
        <div className="tbl-wrap">
          <table className="thr">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Status it triggers</th>
                <th>When power is this far from normal</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([key, label]) => (
                <tr key={key}>
                  <td className="mono">Fixed limit</td>
                  <td>{label}</td>
                  <td>
                    <input
                      type="number"
                      value={text[key]}
                      onChange={(e) => setText((t) => ({ ...t, [key]: e.target.value }))}
                    />
                    <span style={{ marginLeft: 6, color: 'var(--muted)', fontSize: 12 }}>%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="primary" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="prov" style={{ color: 'var(--ok)' }}>Saved</span>}
        </div>
        <p className="prov">
          If power goes past an 'Action required' limit, the machine turns red and a critical alert is raised. Past a 'Watch' limit it turns yellow. This is simple arithmetic, not AI.
        </p>
      </div>
    </section>
  );
}
