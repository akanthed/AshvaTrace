import { Router } from 'express';
import { getDashboardLayout, putDashboardLayout } from '../controllers/dashboardLayoutController';

export const dashboardLayoutRoutes = Router();

dashboardLayoutRoutes.get('/:machineId', getDashboardLayout);
dashboardLayoutRoutes.put('/:machineId', putDashboardLayout);
