import { Request, Response } from 'express';
import {
  getShiftSummary as fetchSummary,
  getThresholdViolations as fetchViolations,
  getEnergyReport as fetchEnergy,
  getMachineComparison as fetchComparison,
} from '../services/analyticsService';

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
