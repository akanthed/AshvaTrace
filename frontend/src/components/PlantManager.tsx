import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Machine } from '../types';
import { api } from '../services/api';

interface Props {
  machines: Machine[];
  onChange: () => void;
  currentMachineId?: string;
}

const emptyForm = { id: '', name: '', type: '' };

export function PlantManager({ machines, onChange, currentMachineId }: Props) {
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const startEdit = (m: Machine) => {
    setEditingId(m.id);
    setForm({ id: m.id, name: m.name, type: m.type });
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (editingId) {
        await api.updateMachine(editingId, {
          name: form.name,
          type: form.type,
        });
      } else {
        await api.createMachine({
          id: form.id,
          name: form.name,
          type: form.type,
        });
      }
      cancelEdit();
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save machine');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await api.deleteMachine(id);
      if (editingId === id) cancelEdit();
      onChange();
      if (id === currentMachineId) navigate('/monitoring');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete machine');
    }
  };

  return (
    <section className="panel">
      <header>
        <h3>Plant · Machines</h3>
        <div className="sp" />
        <span className="prov">Add, rename or remove machines — set alarm/warning limits in the Threshold tab</span>
      </header>
      <div className="body" style={{ display: 'grid', gap: 16 }}>
        {error && <div className="prov" style={{ color: 'var(--crit)' }}>{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 10 }}>
          <div className="assume" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <label>
              Machine ID
              <input
                type="text"
                value={form.id}
                disabled={!!editingId}
                onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                placeholder="e.g. CNC-05"
                required
              />
            </label>
            <label>
              Name
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. CNC Mill 05"
                required
              />
            </label>
            <label>
              Type
              <input
                type="text"
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                placeholder="e.g. milling"
                required
              />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add machine'}
            </button>
            {editingId && (
              <button type="button" className="ghost" onClick={cancelEdit}>
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Machine</th>
                <th>Type</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => (
                <tr key={m.id}>
                  <td className="mono">
                    {m.id}
                    <br />
                    <small>{m.name}</small>
                  </td>
                  <td>{m.type}</td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <button className="ghost" onClick={() => startEdit(m)}>
                      Edit
                    </button>
                    <button className="ghost" onClick={() => handleDelete(m.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
