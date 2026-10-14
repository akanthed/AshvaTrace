import { useEffect, useState } from 'react';

// Rotating manufacturing/industrial messages shown while data loads.
// Keeps the user engaged and reinforces the domain context instead of
// showing a blank "Loading…" for several seconds.
const MESSAGES = [
  'Calibrating sensor baselines…',
  'Reading spindle telemetry…',
  'Syncing shift data from the plant floor…',
  'Checking vibration signatures…',
  'Pulling power draw from the grid…',
  'Warming up the AI investigation engine…',
  'Cross-referencing maintenance SOPs…',
  'Measuring cycle times…',
  'Inspecting tool wear patterns…',
  'Connecting to machine controllers…',
];

interface Props {
  label?: string;
  full?: boolean;
}

export function LoadingSpinner({ label, full = true }: Props) {
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex((i) => (i + 1) % MESSAGES.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const message = label || MESSAGES[msgIndex];

  return (
    <div className={`loading ${full ? 'loading-full' : ''}`}>
      <div className="spinner-wrap">
        <div className="spinner" />
        <div className="spinner-text">
          <span className="spinner-msg">{message}</span>
          <span className="spinner-sub">AshvaTrace · Intelligent Operations</span>
        </div>
      </div>
    </div>
  );
}
