import { Router } from 'express';
import { getAlerts, getAlertsByMachine, acknowledgeAlert } from '../controllers/alertController';

export const alertRoutes = Router();

alertRoutes.get('/', getAlerts);
alertRoutes.get('/machine/:id', getAlertsByMachine);
alertRoutes.post('/:id/acknowledge', acknowledgeAlert);
