import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MachineView } from '../pages/MachineView';

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

const mockMachine = {
  id: 'CNC-03',
  name: 'CNC Mill 03',
  type: 'milling',
  thresholds: { upperAlarm: 25, upperWarning: 10, lowerWarning: -10, lowerAlarm: -25 },
};

const mockStatus = {
  machineId: 'CNC-03',
  name: 'CNC Mill 03',
  status: 'critical' as const,
  devPct: 1152.1,
  actual: 600.9,
  expected: 48.0,
  vibration: 3.2,
  cycleTime: 95,
  timestamp: '13:59',
};

const mockSeries = {
  machineId: 'CNC-03',
  from: 0,
  to: 100,
  samples: 100,
  series: Array.from({ length: 100 }, (_, i) => ({
    timestamp: `06:${String(Math.floor(i / 5)).padStart(2, '0')}:${String((i % 5) * 12).padStart(2, '0')}`,
    actual: 48 + (i > 80 ? (i - 80) * 5 : 0),
    expected: 48,
    vibration: 2.5,
    cycleTime: 120,
  })),
};

describe('MachineView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getMachine as Mock).mockResolvedValue(mockMachine);
    (api.getMachineStatus as Mock).mockResolvedValue(mockStatus);
    (api.getMachineSeries as Mock).mockResolvedValue(mockSeries);
    (api.getAlerts as Mock).mockResolvedValue([]);
    (api.getMachines as Mock).mockResolvedValue([mockMachine]);
    (api.getIncidents as Mock).mockResolvedValue([]);
  });

  const renderMachineView = (initialPath = '/machine/CNC-03') =>
    render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/machine/:id" element={<MachineView />} />
        </Routes>
      </MemoryRouter>
    );

  it('renders the machine name', async () => {
    renderMachineView();
    expect(await screen.findByText('CNC Mill 03')).toBeInTheDocument();
  });

  it('shows critical badge for CNC-03', async () => {
    renderMachineView();
    await waitFor(() => {
      expect(screen.getByText('critical')).toBeInTheDocument();
    });
  });

  it('shows "Action required" for critical machines', async () => {
    renderMachineView();
    await waitFor(() => {
      expect(screen.getByText('Action required')).toBeInTheDocument();
    });
  });

  it('displays the Monitor group tabs by default, hiding Investigate & Verify tabs', async () => {
    renderMachineView();
    await waitFor(() => {
      expect(screen.getByText('Monitoring')).toBeInTheDocument();
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Threshold')).toBeInTheDocument();
      expect(screen.getByText('Trends')).toBeInTheDocument();
      expect(screen.getByText('Plant')).toBeInTheDocument();
      expect(screen.queryByText('Investigate')).not.toBeInTheDocument();
      expect(screen.queryByText('Actions')).not.toBeInTheDocument();
      expect(screen.queryByText('Verify')).not.toBeInTheDocument();
      expect(screen.queryByText('Audit')).not.toBeInTheDocument();
    });
  });

  it('shows only the Investigate & Verify tabs when a tab in that group is active, hiding Monitor tabs', async () => {
    renderMachineView('/machine/CNC-03?tab=investigate');
    await waitFor(() => {
      expect(screen.getAllByText('Investigate').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Actions')).toBeInTheDocument();
      expect(screen.getByText('Verify')).toBeInTheDocument();
      expect(screen.getByText('Audit')).toBeInTheDocument();
      expect(screen.queryByText('Monitoring')).not.toBeInTheDocument();
      expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
      expect(screen.queryByText('Threshold')).not.toBeInTheDocument();
      expect(screen.queryByText('Trends')).not.toBeInTheDocument();
      expect(screen.queryByText('Plant')).not.toBeInTheDocument();
    });
  });

  it('shows monitoring tab by default with this machine’s row only', async () => {
    renderMachineView();
    await waitFor(() => {
      expect(screen.getAllByText('CNC Mill 03').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('+1152.1%')).toBeInTheDocument();
    });
  });

  it('shows Power Trends when navigated to the Trends tab', async () => {
    renderMachineView('/machine/CNC-03?tab=trends');
    await waitFor(() => {
      expect(screen.getByText('Power Trends')).toBeInTheDocument();
    });
  });

  it('has a back link to home', async () => {
    renderMachineView();
    await waitFor(() => {
      const backLink = screen.getByText('← Home');
      expect(backLink).toHaveAttribute('href', '/');
    });
  });
});
