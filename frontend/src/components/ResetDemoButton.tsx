import { useState } from 'react';
import { api } from '../services/api';

// Puts the sample problems back so the demo can be run again. Closed incidents stay
// as history; open ones are closed and fresh ones are created.
export function ResetDemoButton({ onDone, compact = false }: { onDone?: () => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    if (!window.confirm('Restore the sample problems? Anything currently open will be closed, and fresh problems will be created to work on.')) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.resetDemo();
      setMsg(`Done. ${r.created} fresh problem${r.created === 1 ? '' : 's'} ready.`);
      onDone?.();
    } catch (e: any) {
      setMsg(e.message || 'Could not reset the demo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <button className={compact ? 'ghost' : 'primary'} onClick={run} disabled={busy}>
        {busy ? 'Restoring…' : 'Restore sample problems'}
      </button>
      {msg && <span className="prov">{msg}</span>}
    </span>
  );
}
