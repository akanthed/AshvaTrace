import { useEffect, useState } from 'react';

// Rotating manufacturing/industrial messages shown while data loads.
// Keeps the user engaged and reinforces the domain context instead of
// showing a blank "Loading…" for several seconds.
const MESSAGES = [
  'Getting machine readings ready…',
  'Reading the machine numbers…',
  'Loading this shift\'s data…',
  'Checking vibration…',
  'Checking power use…',
  'Getting the AI ready…',
  'Looking up the plant\'s repair procedures…',
  'Checking time per part…',
  'Checking tool wear…',
  'Loading the demo machines…',
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
          <span className="spinner-sub">AshvaTrace</span>
        </div>
      </div>
    </div>
  );
}
