import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAlerts } from '../hooks/useAlerts';

type GroupKey = 'monitor' | 'investigate';

interface Tile {
  title: string;
  desc: string;
  icon: ReactElement;
  go: string;
  flagged?: boolean;
}

const ICONS: Record<string, ReactElement> = {
  plant: (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M4 42V22l10 6v-6l10 6v-6l10 6V8h8v34z" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M5 38l10-12 8 6 9-14 11 8" />
      <path d="M5 43h38" />
    </svg>
  ),
  ai: (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M8 10h32v22H22l-8 8v-8H8z" />
      <path d="M16 21h16" />
    </svg>
  ),
  wrench: (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M30 6a10 10 0 0 0-9 14L6 35l7 7 15-15A10 10 0 0 0 42 18l-6 6-6-2-2-6 6-6z" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="24" cy="24" r="18" />
      <path d="M15 24l7 7 12-14" />
    </svg>
  ),
  log: (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M10 6h28v36H10z" />
      <path d="M16 15h16M16 23h16M16 31h10" />
    </svg>
  ),
  gear: (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="24" cy="24" r="6" />
      <path d="M24 4v7M24 37v7M4 24h7M37 24h7M10 10l5 5M33 33l5 5M10 38l5-5M33 15l5-5" />
    </svg>
  ),
  stack: (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5">
      <rect x="6" y="6" width="36" height="10" />
      <rect x="6" y="19" width="36" height="10" />
      <rect x="6" y="32" width="36" height="10" />
    </svg>
  ),
  gauge: (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M8 34a16 16 0 1 1 32 0" />
      <path d="M24 34 L32 20" />
    </svg>
  ),
};

interface CriticalContext {
  machineId?: string;
  incidentId?: string;
}

function useGroups({ machineId, incidentId }: CriticalContext): Array<[GroupKey, string, Tile[]]> {
  const trendsMachine = machineId ?? 'CNC-03';
  // Investigation/Interventions/Verification/Audit all live on the open incident's page —
  // fall back to the machine's own tab (which itself links to the incident) when none is open.
  const incidentOrMachine = (tab: string) =>
    incidentId ? `/incident/${incidentId}?tab=${tab}` : `/machine/${trendsMachine}?tab=${tab}`;

  return [
    [
      'monitor',
      'Monitor',
      [
        {
          title: 'Monitoring',
          desc: 'A machine’s current power, expected power and deviation',
          icon: ICONS.plant,
          go: `/machine/${trendsMachine}?tab=monitoring`,
          flagged: !!incidentId,
        },
        {
          title: 'Dashboard',
          desc: 'A machine’s own dashboard of live tiles',
          icon: ICONS.stack,
          go: `/machine/${trendsMachine}?tab=dashboard`,
        },
        {
          title: 'Threshold',
          desc: 'The warning and critical limits that decide a machine’s status',
          icon: ICONS.gauge,
          go: `/machine/${trendsMachine}?tab=threshold`,
        },
        {
          title: 'Trends',
          desc: "A machine's power over time, actual vs. expected",
          icon: ICONS.chart,
          go: `/machine/${trendsMachine}?tab=trends`,
        },
      ],
    ],
    [
      'investigate',
      'Investigate & verify',
      [
        {
          title: 'Investigation',
          desc: 'AI suggests likely causes, each with the evidence for and against it',
          icon: ICONS.ai,
          go: incidentOrMachine('investigate'),
        },
        {
          title: 'Interventions',
          desc: 'Pick a fix, see what it should do, then approve it',
          icon: ICONS.wrench,
          go: incidentOrMachine('actions'),
        },
        {
          title: 'Verification',
          desc: 'After the fix, confirm it actually worked — checked by code, not AI',
          icon: ICONS.check,
          go: incidentOrMachine('verify'),
        },
        {
          title: 'Audit trail',
          desc: 'A timestamped record of every step taken on this incident',
          icon: ICONS.log,
          go: incidentOrMachine('audit'),
        },
      ],
    ],
  ];
}

export default function LaunchView() {
  const navigate = useNavigate();
  const { alerts } = useAlerts();
  const criticalAlert = alerts.find((a) => a.severity === 'critical');
  const groups = useGroups({ machineId: criticalAlert?.machineId, incidentId: criticalAlert?.incidentId });
  const [group, setGroup] = useState<GroupKey>('monitor');
  const scrollingRef = useRef(false);

  const scrollToGroup = (k: GroupKey) => {
    scrollingRef.current = true;
    setGroup(k);
    document.getElementById(`g-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => {
      scrollingRef.current = false;
    }, 600);
  };

  useEffect(() => {
    const sections = groups
      .map(([k]) => document.getElementById(`g-${k}`))
      .filter((el): el is HTMLElement => !!el);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (scrollingRef.current) return;
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        const id = topMost.target.id.replace(/^g-/, '') as GroupKey;
        setGroup(id);
      },
      { root: document.querySelector('main'), threshold: 0.3 }
    );

    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="launch">
      <div className="gtabs">
        {groups.map(([k, label]) => (
          <button key={k} className={group === k ? 'on' : ''} onClick={() => scrollToGroup(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="sheet">
        <div className="hero">
          <svg width="96" height="80" viewBox="0 0 96 80" aria-hidden="true">
            <path
              d="M6 64 L26 30 L42 50 L58 14 L90 64"
              fill="none"
              stroke="var(--fg)"
              strokeWidth="5"
              strokeLinejoin="round"
            />
            <circle cx="58" cy="14" r="7" fill="var(--accent)" />
            <path d="M6 74h84" stroke="var(--accent)" strokeWidth="4" />
          </svg>
          <b>AshvaTrace</b>
          <span>
            Detect the signal.
            <br />
            Investigate the cause.
            <br />
            Verify the improvement.
          </span>
        </div>
        <div>
          {groups.map(([k, label, tiles]) => (
            <section className="sec" id={`g-${k}`} key={k}>
              <h2>{label}</h2>
              <div className="tiles">
                {tiles.map((t) => (
                  <button key={t.title} className="tile" onClick={() => navigate(t.go)}>
                    <b>{t.title}</b>
                    <span>{t.desc}</span>
                    {t.flagged && <i className="flag">1 action required</i>}
                    {t.icon}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
