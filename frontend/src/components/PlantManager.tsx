import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Machine } from '../types';
import { api } from '../services/api';

interface Props {
  machines: Machine[];
  onChange: () => void;
  currentMachineId?: string;
}

const emptyForm = { id: '', name: '', type: '', ip: '', port: '4840' };

// Quick check before sending; the server checks again. Accepts IPv4 such as 192.168.10.15.
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function addressProblem(ip: string, port: string): string | null {
  if (!ip.trim()) return 'Enter the IP address of the machine';
  if (!IPV4.test(ip.trim())) return 'That is not a valid IP address (example: 192.168.10.15)';
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return 'Port must be a whole number from 1 to 65535 (example: 4840)';
  return null;
}

export function PlantManager({ machines, onChange, currentMachineId }: Props) {
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const startEdit = (m: Machine) => {
    setEditingId(m.id);
    setForm({ id: m.id, name: m.name, type: m.type, ip: m.ip ?? '', port: m.port ? String(m.port) : '4840' });
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
    // A machine that never had an address may be edited without one; a new machine needs it.
    const legacyBlank = !!editingId && !form.ip.trim();
    const problem = legacyBlank ? null : addressProblem(form.ip, form.port);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.updateMachine(editingId, {
          name: form.name,
          type: form.type,
          ...(legacyBlank ? {} : { ip: form.ip.trim(), port: Number(form.port) }),
        });
      } else {
        await api.createMachine({
          id: form.id,
          name: form.name,
          type: form.type,
          ip: form.ip.trim(),
          port: Number(form.port),
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
    if (!window.confirm(`Delete machine ${id}? This cannot be undone.`)) return;
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
        <span className="prov">Add, rename or remove machines</span>
      </header>
      <div className="body" style={{ display: 'grid', gap: 16 }}>
        {error && <div className="prov" style={{ color: 'var(--crit)' }}>{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 10 }}>
          <div className="assume">
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
            <label>
              IP address
              <input
                type="text"
                inputMode="decimal"
                value={form.ip}
                onChange={(e) => setForm((f) => ({ ...f, ip: e.target.value }))}
                placeholder="e.g. 192.168.10.15"
                required={!editingId}
              />
            </label>
            <label>
              Port
              <input
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                placeholder="e.g. 4840"
                required={!editingId}
              />
            </label>
          </div>
          <p className="prov" style={{ margin: 0 }}>
            Each machine is added by the IP address and port of its data source (for example an OPC UA gateway on port 4840). The address is saved
            with the machine, but this demo does not connect to it: all readings are simulated.
          </p>
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
                <th>Address</th>
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
                  <td className="mono">{m.ip ? `${m.ip}:${m.port}` : <span className="prov">Not set</span>}</td>
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
