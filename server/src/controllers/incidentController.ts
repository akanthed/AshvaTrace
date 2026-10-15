import { Request, Response } from 'express';
import {
  getIncidents as fetchIncidents,
  getIncidentById,
  getIncidentsForMachine,
  investigateIncident as runInvestigation,
  simulateAction as runSimulation,
  verifyOutcome as runVerification,
  getAuditLog as fetchAuditLog,
  updateIncidentStatus,
  findSimilarIncidents,
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

export async function updateStatus(req: Request, res: Response) {
  try {
    const { status, resolutionComment } = req.body;
    const result = updateIncidentStatus(req.params.id, status, resolutionComment);
    if (!result) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
}

export async function getSimilarIncidents(req: Request, res: Response) {
  const incident = getIncidentById(req.params.id);
  if (!incident) {
    res.status(404).json({ error: 'Incident not found' });
    return;
  }
  const similar = findSimilarIncidents(incident.machineId, incident.devPct, incident.id);
  res.json(similar);
}

export async function getIncidentsByMachine(req: Request, res: Response) {
  const machineId = req.query.machineId as string;
  if (!machineId) {
    res.status(400).json({ error: 'machineId query parameter is required' });
    return;
  }
  const list = getIncidentsForMachine(machineId);
  res.json(list);
}
