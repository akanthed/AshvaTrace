import { Router } from 'express';
import { getSystemStatus, resetDemoData } from '../controllers/systemController';

export const systemRoutes = Router();

systemRoutes.get('/status', getSystemStatus);
systemRoutes.post('/reset-demo', resetDemoData);
