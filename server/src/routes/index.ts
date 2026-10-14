import { Router } from 'express';
import { machineRoutes } from './machineRoutes';
import { incidentRoutes } from './incidentRoutes';
import { analyticsRoutes } from './analyticsRoutes';
import { alertRoutes } from './alertRoutes';
import { sseRoutes } from './sseRoutes';
import { systemRoutes } from './systemRoutes';
import { dashboardLayoutRoutes } from './dashboardLayoutRoutes';

export const routes = Router();

routes.use('/machines', machineRoutes);
routes.use('/incidents', incidentRoutes);
routes.use('/analytics', analyticsRoutes);
routes.use('/alerts', alertRoutes);
routes.use('/sse', sseRoutes);
routes.use('/system', systemRoutes);
routes.use('/dashboard-layout', dashboardLayoutRoutes);
