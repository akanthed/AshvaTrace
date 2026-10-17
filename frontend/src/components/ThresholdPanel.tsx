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
  const [form, setForm] = useState<Thresholds>(thresholds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = ROWS.some(([key]) => form[key] !== thresholds[key]);

  const handleSave = async () => {
    setError(null);
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
                      value={form[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }))}
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
