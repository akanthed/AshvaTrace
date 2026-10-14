export interface Thresholds {
  upperAlarm: number;
  upperWarning: number;
  lowerWarning: number;
  lowerAlarm: number;
}

export interface Machine {
  id: string;
  name: string;
  type: string;
  thresholds: Thresholds;
}

export interface Sample {
  timestamp: string;
  actual: number;
  expected: number;
  vibration: number;
  cycleTime: number;
}

export interface MachineStatus {
  machineId: string;
  name: string;
  status: 'normal' | 'warning' | 'critical';
  devPct: number;
  actual: number;
  expected: number;
  vibration: number;
  cycleTime: number;
  timestamp: string;
}

export interface MachineSeries {
  machineId: string;
  from: number;
  to: number;
  samples: number;
  series: Sample[];
}

export interface Hypothesis {
  id: string;
  title: string;
  confidence: number;
  evidenceFor: string[];
  evidenceAgainst: string[];
}

export interface Incident {
  id: string;
  machineId: string;
  machineName: string;
  status: 'open' | 'investigating' | 'action_taken' | 'verified' | 'closed';
  detectedAt: string;
  severity: 'warning' | 'critical';
  devPct: number;
  hypotheses: Hypothesis[];
  selectedHypothesis?: string;
  simulation?: {
    action: string;
    predictedOutcome: string;
    confidence: number;
  };
  verification?: {
    passed: boolean;
    actualOutcome: string;
    metrics: Record<string, number>;
  };
  auditLog: AuditEntry[];
}

export interface AuditEntry {
  timestamp: string;
  actor: string;
  action: string;
  details: string;
}

export interface Alert {
  id: string;
  machineId: string;
  machineName: string;
  severity: 'warning' | 'critical';
  devPct: number;
  message: string;
  timestamp: string;
  acknowledged: boolean;
  incidentId?: string;
}

export interface ShiftSummary {
  shiftStart: string;
  shiftEnd: string;
  machines: Array<{
    machineId: string;
    name: string;
    avgDevPct: number;
    warnings: number;
    criticals: number;
    status: string;
  }>;
  totalWarnings: number;
  totalCriticals: number;
}

export interface ThresholdViolation {
  machineId: string;
  machineName: string;
  timestamp: string;
  sampleIndex: number;
  devPct: number;
  severity: 'warning' | 'critical';
  actual: number;
  expected: number;
}

export interface SystemStatus {
  ai: { configured: boolean; model: string; location: string };
  bigquery: { configured: boolean; dataset: string };
  pubsub: { configured: boolean; topic: string | null };
  simulatedData: boolean;
}

export interface DashboardLayout {
  machineId: string;
  imageDataUrl: string | null;
  tileXPct: number | null;
  tileYPct: number | null;
  locked: boolean;
}
