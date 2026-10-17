import { Request, Response } from 'express';
import {
  getShiftSummary as fetchSummary,
  getThresholdViolations as fetchViolations,
  getEnergyReport as fetchEnergy,
  getMachineComparison as fetchComparison,
  getCostImpact as fetchCostImpact,
} from '../services/analyticsService';
import { getTrackRecord as fetchTrackRecord } from '../services/trackRecordService';

export async function getShiftSummary(_req: Request, res: Response) {
  const summary = fetchSummary();
  res.json(summary);
}

export async function getThresholdViolations(req: Request, res: Response) {
  const { machineId } = req.query;
  const violations = fetchViolations(machineId as string | undefined);
  res.json(violations);
}

export async function getEnergyReport(_req: Request, res: Response) {
  const report = fetchEnergy();
  res.json(report);
}

export async function getMachineComparison(_req: Request, res: Response) {
  const comparison = fetchComparison();
  res.json(comparison);
}

export async function getCostImpact(_req: Request, res: Response) {
  const impact = fetchCostImpact();
  res.json(impact);
}

export async function getTrackRecord(req: Request, res: Response) {
  const { machineId } = req.query;
  res.json(fetchTrackRecord(machineId as string | undefined));
}
