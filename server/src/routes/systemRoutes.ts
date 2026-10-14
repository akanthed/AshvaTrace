import { Router } from 'express';
import { getSystemStatus } from '../controllers/systemController';

export const systemRoutes = Router();

systemRoutes.get('/status', getSystemStatus);
