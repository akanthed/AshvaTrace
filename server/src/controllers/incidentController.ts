import { Request, Response } from 'express';
import {
  getIncidents as fetchIncidents,
  getIncidentById,
  investigateIncident as runInvestigation,
  simulateAction as runSimulation,
  verifyOutcome as runVerification,
  getAuditLog as fetchAuditLog,
} from '../services/incidentService';

export async function getIncidents(_req: Request, res: Response) {
  const incidents = fetchIncidents();
  res.json(incidents);
}

export async function getIncident(req: Request, res: Response) {
  const incident = getIncidentById(req.params.id);
  if (!incident) {
    res.status(404).json({ error: 'Incident not found' });
    return;
  }
  res.json(incident);
}

export async function investigateIncident(req: Request, res: Response) {
  try {
    const result = await runInvestigation(req.params.id, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function simulateAction(req: Request, res: Response) {
  try {
    const result = await runSimulation(req.params.id, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function verifyOutcome(req: Request, res: Response) {
  try {
    const result = await runVerification(req.params.id, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function getAuditLog(req: Request, res: Response) {
  const log = fetchAuditLog(req.params.id);
  res.json(log);
}
