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
  ['upperAlarm', 'Upper alarm'],
  ['upperWarning', 'Upper warning'],
  ['lowerWarning', 'Lower warning'],
  ['lowerAlarm', 'Lower alarm'],
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
      setError('Upper alarm must be at or above upper warning');
      return;
    }
    if (form.lowerAlarm > form.lowerWarning) {
      setError('Lower alarm must be at or below lower warning');
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateMachine(machineId, { thresholds: form });
      onSaved(updated.thresholds);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save thresholds');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel">
      <header>
        <h3>Threshold · {machineId}</h3>
        <div className="sp" />
        <span className="prov">Power deviation limits that decide this machine's status</span>
      </header>
      <div className="body" style={{ display: 'grid', gap: 16 }}>
        {error && <div className="prov" style={{ color: 'var(--crit)' }}>{error}</div>}
        <div className="tbl-wrap">
          <table className="thr">
            <thead>
              <tr>
                <th>Type</th>
                <th>Alarm type</th>
                <th>Threshold value</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([key, label]) => (
                <tr key={key}>
                  <td className="mono">Static threshold</td>
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
          Deviation at or beyond an alarm limit turns the status red and raises a critical alert. At or beyond a
          warning limit it turns yellow and raises a warning alert. This is plain math, not AI.
        </p>
      </div>
    </section>
  );
}
