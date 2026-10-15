import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAlerts } from '../hooks/useAlerts';
import { AssistantPanel } from './AssistantPanel';

function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const date = now.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const time = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className="clock">
      <div>{date}</div>
      <div>{time}</div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return `${hours}h ago`;
}

export default function TopBar() {
  const navigate = useNavigate();
  const { alerts } = useAlerts();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  const unacknowledged = alerts.filter((a) => !a.acknowledged);
  const criticalAlert = alerts.find((a) => a.severity === 'critical');

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  useEffect(() => {
    if (!profileOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [profileOpen]);

  const openAlert = (alert: (typeof alerts)[number]) => {
    setOpen(false);
    navigate(alert.incidentId ? `/incident/${alert.incidentId}` : `/machine/${alert.machineId}`);
  };

  return (
    <header className="top">
      {/* Left: utility icons + brand */}
      <div className="top-left">
        <div className="notif-wrap" ref={profileRef}>
          <button className="ico-btn" title="Account" aria-label="Account" onClick={() => setProfileOpen((o) => !o)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </button>
          {profileOpen && (
            <div className="notif-panel" style={{ minWidth: 180 }}>
              <header>Account</header>
              <ul style={{ display: 'grid', gap: 4 }}>
                <li style={{ cursor: 'default', padding: '6px 8px' }}>
                  <b>Engineer</b>
                  <small style={{ display: 'block' }}>Pune Plant · Shift A</small>
                </li>
                <li onClick={() => { setProfileOpen(false); navigate('/settings'); }} style={{ cursor: 'pointer', padding: '6px 8px' }}>
                  <b>Settings</b>
                </li>
                <li style={{ padding: '6px 8px', color: 'var(--muted)', fontSize: 12 }}>
                  Simulated session — no real auth
                </li>
              </ul>
            </div>
          )}
        </div>
        <button className="ico-btn" title="Home" aria-label="Home" onClick={() => navigate('/')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M9 22V12h6v10" />
          </svg>
        </button>

        <button className="brand" onClick={() => navigate('/')}>
          <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
            <path
              d="M2 20 L8 8 L13 15 L17 5 L24 20"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.4"
              strokeLinejoin="round"
            />
            <circle cx="17" cy="5" r="2.4" fill="var(--crit)" />
          </svg>
          <b>AshvaTrace</b>
          <small>by Team Ashvamedh</small>
        </button>
      </div>

      {/* Center: assistant bar */}
      <button className="assistant-bar" onClick={() => setAssistantOpen(true)} aria-label="Ask the assistant">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span className="assistant-ph">How can I assist you today?</span>
        <span className="assistant-actions">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <path d="M12 19v4" />
          </svg>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M12 5l7 7-7 7" />
          </svg>
        </span>
      </button>

      <div className="sp" />

      <span className="sim">SIMULATED DATA</span>

      <Clock />

      <div className="notif-wrap" ref={panelRef}>
        <button className="ico-btn" title="Notifications" aria-label="Notifications" onClick={() => setOpen((o) => !o)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {unacknowledged.length > 0 && <span className="badge">{unacknowledged.length}</span>}
        </button>

        {open && (
          <div className="notif-panel">
            <header>Notifications</header>
            {alerts.length === 0 ? (
              <div className="notif-empty">No alerts right now.</div>
            ) : (
              <ul>
                {alerts.map((a) => (
                  <li key={a.id} onClick={() => openAlert(a)}>
                    <span className={`st ${a.severity === 'critical' ? 'crit' : 'warn'}`} />
                    <div>
                      <b>{a.machineName}</b>
                      <small>{a.message}</small>
                      <small className="prov">{timeAgo(a.timestamp)}</small>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <button
        className="ico-btn"
        title={criticalAlert ? `Open active incident (${criticalAlert.machineName})` : 'No active critical incident'}
        aria-label="Open the active incident"
        onClick={() => criticalAlert && navigate(criticalAlert.incidentId ? `/incident/${criticalAlert.incidentId}` : `/machine/${criticalAlert.machineId}`)}
        disabled={!criticalAlert}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        {criticalAlert && <span className="badge">1</span>}
      </button>

      <button className="ico-btn" title="Settings" aria-label="Settings" onClick={() => navigate('/settings')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
    </header>
  );
}
