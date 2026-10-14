import type { AuditEntry } from '../types';

interface Props {
  entries: AuditEntry[];
}

export function AuditLog({ entries }: Props) {
  if (entries.length === 0) {
    return <div className="empty">No audit entries</div>;
  }

  return (
    <ul className="audit" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {entries.map((e, i) => (
        <li key={i}>
          <time>{new Date(e.timestamp).toLocaleTimeString()}</time>
          <span>
            <span className="mono" style={{ color: 'var(--muted)' }}>
              [{e.actor}]
            </span>{' '}
            {e.details}
          </span>
        </li>
      ))}
    </ul>
  );
}
