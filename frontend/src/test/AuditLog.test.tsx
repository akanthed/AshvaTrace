import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuditLog } from '../components/AuditLog';
import type { AuditEntry } from '../types';

const mockEntries: AuditEntry[] = [
  { timestamp: '2026-10-13T13:59:00Z', actor: 'system', action: 'alert_created', details: 'Critical alert: CNC-03 deviation 1152.1%' },
  { timestamp: '2026-10-13T13:58:30Z', actor: 'system', action: 'threshold_check', details: 'CNC-03 exceeded critical threshold' },
  { timestamp: '2026-10-13T13:55:00Z', actor: 'engineer', action: 'acknowledge', details: 'Acknowledged warning on GRD-01' },
  { timestamp: '2026-10-13T13:50:00Z', actor: 'ai', action: 'investigate', details: 'Generated 3 hypotheses for INC-0412' },
];

describe('AuditLog', () => {
  it('renders all audit entries', () => {
    render(<AuditLog entries={mockEntries} />);
    expect(screen.getByText('Critical alert: CNC-03 deviation 1152.1%')).toBeInTheDocument();
    expect(screen.getByText('CNC-03 exceeded critical threshold')).toBeInTheDocument();
    expect(screen.getByText('Acknowledged warning on GRD-01')).toBeInTheDocument();
    expect(screen.getByText('Generated 3 hypotheses for INC-0412')).toBeInTheDocument();
  });

  it('displays actor names in brackets', () => {
    render(<AuditLog entries={mockEntries} />);
    expect(screen.getAllByText('[system]').length).toBe(2);
    expect(screen.getByText('[engineer]')).toBeInTheDocument();
    expect(screen.getByText('[ai]')).toBeInTheDocument();
  });

  it('displays 4 audit entries', () => {
    render(<AuditLog entries={mockEntries} />);
    expect(screen.getByText('Critical alert: CNC-03 deviation 1152.1%')).toBeInTheDocument();
    expect(screen.getByText('CNC-03 exceeded critical threshold')).toBeInTheDocument();
    expect(screen.getByText('Acknowledged warning on GRD-01')).toBeInTheDocument();
    expect(screen.getByText('Generated 3 hypotheses for INC-0412')).toBeInTheDocument();
  });

  it('renders empty state when no entries', () => {
    render(<AuditLog entries={[]} />);
    expect(screen.getByText('No audit entries')).toBeInTheDocument();
  });
});
