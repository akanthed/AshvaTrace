import { Router } from 'express';
import {
  getShiftSummary,
  getThresholdViolations,
  getEnergyReport,
  getMachineComparison,
  getCostImpact,
  getTrackRecord,
} from '../controllers/analyticsController';

export const analyticsRoutes = Router();

analyticsRoutes.get('/shift-summary', getShiftSummary);
analyticsRoutes.get('/threshold-violations', getThresholdViolations);
analyticsRoutes.get('/energy-report', getEnergyReport);
analyticsRoutes.get('/machine-comparison', getMachineComparison);
analyticsRoutes.get('/cost-impact', getCostImpact);
analyticsRoutes.get('/track-record', getTrackRecord);
