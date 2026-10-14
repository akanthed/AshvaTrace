import { Request, Response } from 'express';
import { getAlerts as fetchAlerts, getAlertsByMachine as fetchByMachine, acknowledgeAlert as ackAlert } from '../services/alertService';

export async function getAlerts(_req: Request, res: Response) {
  const alerts = fetchAlerts();
  res.json(alerts);
}

export async function getAlertsByMachine(req: Request, res: Response) {
  const alerts = fetchByMachine(req.params.id);
  res.json(alerts);
}

export async function acknowledgeAlert(req: Request, res: Response) {
  const result = ackAlert(req.params.id, req.body);
  if (!result) {
    res.status(404).json({ error: 'Alert not found' });
    return;
  }
  res.json(result);
}
