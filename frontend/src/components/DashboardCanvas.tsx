import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import type { DashboardLayout, MachineStatus, Thresholds } from '../types';
import { statusForDeviation } from '../utils/thresholds';

interface Props {
  machineId: string;
  status: MachineStatus;
  thresholds: Thresholds;
}

function devClass(dev: number, thresholds: Thresholds): string {
  const status = statusForDeviation(dev, thresholds);
  if (status === 'critical') return 'dev-up';
  if (status === 'warning') return 'dev-mid';
  return '';
}

export function DashboardCanvas({ machineId, status, thresholds }: Props) {
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  // Set the moment a local upload happens, before it's saved. Guards the
  // initial fetch's response (which can land after StrictMode's double
  // invoke, or simply after a slow network round-trip) from clobbering an
  // upload the user has already made but not yet saved.
  const dirtyRef = useRef(false);

  useEffect(() => {
    dirtyRef.current = false;
    let cancelled = false;
    setLoading(true);
    api
      .getDashboardLayout(machineId)
      .then((l) => {
        if (cancelled || dirtyRef.current) return;
        setLayout(l);
        setPos({ x: l.tileXPct ?? 50, y: l.tileYPct ?? 50 });
        setEditing(!l.locked && !!l.imageDataUrl);
      })
      .catch(() => {
        if (!cancelled && !dirtyRef.current) setError('Could not load the saved layout');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [machineId]);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file');
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      dirtyRef.current = true;
      const dataUrl = reader.result as string;
      setLayout((l) => ({
        machineId,
        imageDataUrl: dataUrl,
        tileXPct: l?.tileXPct ?? 50,
        tileYPct: l?.tileYPct ?? 50,
        locked: false,
      }));
      setEditing(true);
    };
    reader.readAsDataURL(file);
  };

  const movePointer = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));
    setPos({ x, y });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!editing) return;
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    movePointer(e.clientX, e.clientY);
  };

  const onPointerUp = () => {
    draggingRef.current = false;
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveDashboardLayout(machineId, {
        imageDataUrl: layout?.imageDataUrl ?? null,
        tileXPct: pos.x,
        tileYPct: pos.y,
        locked: true,
      });
      setLayout(saved);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save layout');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveImage = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveDashboardLayout(machineId, {
        imageDataUrl: null,
        tileXPct: null,
        tileYPct: null,
        locked: false,
      });
      setLayout(saved);
      setPos({ x: 50, y: 50 });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove image');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="prov">Loading dashboard layout…</div>;

  const dev = status.devPct;
  const colorClass = devClass(dev, thresholds);

  if (!layout?.imageDataUrl) {
    return (
      <div className="body" style={{ display: 'grid', gap: 12 }}>
        {error && <div className="prov" style={{ color: 'var(--crit)' }}>{error}</div>}
        <div className="empty">
          <b style={{ color: 'var(--fg)' }}>No blueprint or photo yet</b>
          Upload an image of the machine or plant floor, then drag the Active power tile onto it.
        </div>
        <label className="ghost" style={{ justifySelf: 'start', cursor: 'pointer' }}>
          Upload image
          <input type="file" accept="image/*" onChange={handleUpload} style={{ display: 'none' }} />
        </label>
      </div>
    );
  }

  return (
    <div className="body" style={{ display: 'grid', gap: 12 }}>
      {error && <div className="prov" style={{ color: 'var(--crit)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {layout.locked && !editing ? (
          <button className="ghost" onClick={() => setEditing(true)}>
            Edit position
          </button>
        ) : (
          <button className="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save position'}
          </button>
        )}
        <label className="ghost" style={{ cursor: 'pointer' }}>
          Replace image
          <input type="file" accept="image/*" onChange={handleUpload} style={{ display: 'none' }} />
        </label>
        <button className="ghost" onClick={handleRemoveImage} disabled={saving}>
          Remove image
        </button>
        <span className="prov">{editing ? 'Drag the tile, then save' : 'Position locked'}</span>
      </div>

      <div
        ref={containerRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 900,
          border: '1px solid var(--line)',
          background: 'var(--panel-2)',
        }}
      >
        <img src={layout.imageDataUrl} alt="Machine blueprint" style={{ display: 'block', width: '100%', userSelect: 'none', pointerEvents: 'none' }} />
        <div
          onPointerDown={onPointerDown}
          style={{
            position: 'absolute',
            left: `${pos.x}%`,
            top: `${pos.y}%`,
            transform: 'translate(-50%, -50%)',
            cursor: editing ? 'grab' : 'default',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 4,
            padding: '8px 12px',
            minWidth: 110,
            boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
            touchAction: 'none',
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Active power</div>
          <div className={`mono ${colorClass}`} style={{ fontSize: 20, fontWeight: 600 }}>
            {status.actual.toFixed(1)} kW
          </div>
        </div>
      </div>
    </div>
  );
}
