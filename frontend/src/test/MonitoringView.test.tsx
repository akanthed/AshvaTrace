import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MonitoringView from '../pages/MonitoringView';

vi.mock('../services/api', () => ({
  api: {
    getMachines: vi.fn(),
    getMachine: vi.fn(),
    getMachineSeries: vi.fn(),
    getMachineStatus: vi.fn(),
    getIncidents: vi.fn(),
    getIncident: vi.fn(),
    investigateIncident: vi.fn(),
    simulateAction: vi.fn(),
    verifyOutcome: vi.fn(),
    getAuditLog: vi.fn(),
    getShiftSummary: vi.fn(),
    getThresholdViolations: vi.fn(),
    getEnergyReport: vi.fn(),
    getMachineComparison: vi.fn(),
    getAlerts: vi.fn(),
    getAlertsByMachine: vi.fn(),
    acknowledgeAlert: vi.fn(),
  },
  connectSSE: vi.fn(() => () => {}),
}));

import { api } from '../services/api';

const mockMachines = [
  { id: 'CNC-01', name: 'CNC Mill 01', type: 'milling' },
  { id: 'CNC-02', name: 'CNC Mill 02', type: 'milling' },
  { id: 'CNC-03', name: 'CNC Mill 03', type: 'milling' },
  { id: 'CNC-04', name: 'CNC Lathe 04', type: 'turning' },
  { id: 'GRD-01', name: 'Grinder 01', type: 'grinding' },
  { id: 'PRS-01', name: 'Press 01', type: 'stamping' },
];

const mockStatuses = [
  { machineId: 'CNC-01', name: 'CNC Mill 01', status: 'normal', devPct: -2.1, actual: 44.0, expected: 45.0, timestamp: '13:59' },
  { machineId: 'CNC-02', name: 'CNC Mill 02', status: 'normal', devPct: 1.1, actual: 42.5, expected: 42.0, timestamp: '13:59' },
  { machineId: 'CNC-03', name: 'CNC Mill 03', status: 'critical', devPct: 1152.1, actual: 600.9, expected: 48.0, timestamp: '13:59' },
  { machineId: 'CNC-04', name: 'CNC Lathe 04', status: 'normal', devPct: 0.2, actual: 38.0, expected: 38.0, timestamp: '13:59' },
  { machineId: 'GRD-01', name: 'Grinder 01', status: 'normal', devPct: -0.7, actual: 29.8, expected: 30.0, timestamp: '13:59' },
  { machineId: 'PRS-01', name: 'Press 01', status: 'normal', devPct: 1.6, actual: 55.9, expected: 55.0, timestamp: '13:59' },
];

describe('MonitoringView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getMachines as Mock).mockResolvedValue(mockMachines);
    (api.getMachineStatus as Mock).mockImplementation((id: string) => {
      const status = mockStatuses.find((s) => s.machineId === id);
      return Promise.resolve(status);
    });
    (api.getAlerts as Mock).mockResolvedValue([]);
  });

  it('renders the monitoring heading', async () => {
    render(
      <MemoryRouter>
        <MonitoringView />
      </MemoryRouter>
    );
    expect(await screen.findByRole('heading', { name: 'Monitoring' })).toBeInTheDocument();
  });

  it('displays all 6 machines in the table', async () => {
    render(
      <MemoryRouter>
        <MonitoringView />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getAllByText('CNC Mill 01').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('CNC Mill 02').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('CNC Mill 03').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('CNC Lathe 04').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Grinder 01').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Press 01').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows upper-alarm status for CNC-03', async () => {
    render(
      <MemoryRouter>
        <MonitoringView />
      </MemoryRouter>
    );
    await waitFor(() => {
      const labels = screen.getAllByText('Upper alarm');
      expect(labels.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows normal status for healthy machines', async () => {
    render(
      <MemoryRouter>
        <MonitoringView />
      </MemoryRouter>
    );
    await waitFor(() => {
      const normalLabels = screen.getAllByText('Normal');
      expect(normalLabels.length).toBeGreaterThanOrEqual(5);
    });
  });

  it('displays deviation value for CNC-03', async () => {
    render(
      <MemoryRouter>
        <MonitoringView />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getAllByText('+1152.1%').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows summary counts (1 action required, 5 normal)', async () => {
    render(
      <MemoryRouter>
        <MonitoringView />
      </MemoryRouter>
    );
    await waitFor(() => {
      const counts = screen.getAllByText('1');
      expect(counts.length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows each machine as a clickable row', async () => {
    render(
      <MemoryRouter>
        <MonitoringView />
      </MemoryRouter>
    );
    await waitFor(() => {
      const rows = screen.getAllByText('CNC-03');
      const row = rows[0].closest('tr');
      expect(row).toBeInTheDocument();
    });
  });

  it('filters to one machine when machineId is given', async () => {
    render(
      <MemoryRouter>
        <MonitoringView machineId="CNC-03" />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText('CNC Mill 03')).toBeInTheDocument();
      expect(screen.queryByText('CNC Mill 01')).not.toBeInTheDocument();
    });
  });
});
