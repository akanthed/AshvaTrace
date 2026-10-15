import { Router } from 'express';
import {
  getIncidents,
  getIncident,
  investigateIncident,
  simulateAction,
  verifyOutcome,
  getAuditLog,
  updateStatus,
  getSimilarIncidents,
} from '../controllers/incidentController';

export const incidentRoutes = Router();

incidentRoutes.get('/', getIncidents);
incidentRoutes.get('/:id', getIncident);
incidentRoutes.post('/:id/investigate', investigateIncident);
incidentRoutes.post('/:id/simulate', simulateAction);
incidentRoutes.post('/:id/verify', verifyOutcome);
incidentRoutes.get('/:id/audit', getAuditLog);
incidentRoutes.get('/:id/similar', getSimilarIncidents);
incidentRoutes.patch('/:id/status', updateStatus);
