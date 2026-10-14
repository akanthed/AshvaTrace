import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import MachineTable from '../components/MachineTable';
import type { Machine, MachineStatus, Alert } from '../types';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

const mockMachines: Machine[] = [
  { id: 'CNC-01', name: 'CNC Mill 01', type: 'milling', thresholds: { upperAlarm: 25, upperWarning: 10, lowerWarning: -10, lowerAlarm: -25 } },
  { id: 'CNC-03', name: 'CNC Mill 03', type: 'milling', thresholds: { upperAlarm: 25, upperWarning: 10, lowerWarning: -10, lowerAlarm: -25 } },
  { id: 'GRD-01', name: 'Grinder 01', type: 'grinding', thresholds: { upperAlarm: 25, upperWarning: 10, lowerWarning: -10, lowerAlarm: -25 } },
];

function status(overrides: Partial<MachineStatus>): MachineStatus {
  return {
    machineId: 'CNC-01',
    name: 'CNC Mill 01',
    status: 'normal',
    devPct: 0,
    actual: 44,
    expected: 45,
    vibration: 2,
    cycleTime: 90,
    timestamp: '13:59',
    ...overrides,
  };
}

const mockStatuses = new Map<string, MachineStatus>([
  ['CNC-01', status({ machineId: 'CNC-01', name: 'CNC Mill 01', status: 'normal', devPct: -2.1, actual: 44.0, expected: 45.0 })],
  ['CNC-03', status({ machineId: 'CNC-03', name: 'CNC Mill 03', status: 'critical', devPct: 1152.1, actual: 600.9, expected: 48.0 })],
  ['GRD-01', status({ machineId: 'GRD-01', name: 'Grinder 01', status: 'warning', devPct: 15.3, actual: 34.6, expected: 30.0 })],
]);

const mockAlerts: Alert[] = [
  {
    id: 'ALR-1',
    machineId: 'CNC-03',
    machineName: 'CNC Mill 03',
    severity: 'critical',
    devPct: 1152.1,
    message: 'CRITICAL deviation',
    timestamp: new Date().toISOString(),
    acknowledged: false,
    incidentId: 'INC-1',
  },
];

describe('MachineTable', () => {
  it('renders table headers', () => {
    render(
      <MemoryRouter>
        <MachineTable machines={mockMachines} statuses={mockStatuses} />
      </MemoryRouter>
    );
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('Value')).toBeInTheDocument();
    expect(screen.getByText('Unit')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Last update')).toBeInTheDocument();
  });

  it('displays all machines', () => {
    render(
      <MemoryRouter>
        <MachineTable machines={mockMachines} statuses={mockStatuses} />
      </MemoryRouter>
    );
    expect(screen.getByText('CNC Mill 01')).toBeInTheDocument();
    expect(screen.getByText('CNC Mill 03')).toBeInTheDocument();
    expect(screen.getByText('Grinder 01')).toBeInTheDocument();
  });

  it('shows correct status labels', () => {
    render(
      <MemoryRouter>
        <MachineTable machines={mockMachines} statuses={mockStatuses} />
      </MemoryRouter>
    );
    expect(screen.getByText('Upper alarm')).toBeInTheDocument();
    expect(screen.getByText('Upper warning')).toBeInTheDocument();
    expect(screen.getByText('Normal')).toBeInTheDocument();
  });

  it('shows deviation values with sign', () => {
    render(
      <MemoryRouter>
        <MachineTable machines={mockMachines} statuses={mockStatuses} />
      </MemoryRouter>
    );
    expect(screen.getByText('+1152.1%')).toBeInTheDocument();
    expect(screen.getByText('-2.1%')).toBeInTheDocument();
  });

  it('applies row-crit class to the critical row and row-warn to the warning row', () => {
    render(
      <MemoryRouter>
        <MachineTable machines={mockMachines} statuses={mockStatuses} />
      </MemoryRouter>
    );
    const criticalRow = screen.getByText('CNC Mill 03').closest('tr');
    const warningRow = screen.getByText('Grinder 01').closest('tr');
    const normalRow = screen.getByText('CNC Mill 01').closest('tr');
    expect(criticalRow).toHaveClass('row-crit');
    expect(warningRow).toHaveClass('row-warn');
    expect(normalRow).not.toHaveClass('row-crit');
    expect(normalRow).not.toHaveClass('row-warn');
  });

  it('navigates to the incident page when clicking a critical row with an open alert', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <MachineTable machines={mockMachines} statuses={mockStatuses} alerts={mockAlerts} />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    );
    const criticalRow = screen.getByText('CNC Mill 03').closest('tr')!;
    fireEvent.click(criticalRow);
    expect(screen.getByTestId('location')).toHaveTextContent('/incident/INC-1');
  });

  it('navigates to the monitoring tab when clicking a normal row', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <MachineTable machines={mockMachines} statuses={mockStatuses} alerts={mockAlerts} />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    );
    const normalRow = screen.getByText('CNC Mill 01').closest('tr')!;
    fireEvent.click(normalRow);
    expect(screen.getByTestId('location')).toHaveTextContent('/machine/CNC-01?tab=monitoring');
  });
});
