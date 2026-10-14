import { Router } from 'express';
import {
  getMachines,
  getMachine,
  getMachineSeries,
  getMachineStatus,
  postMachine,
  putMachine,
  removeMachine,
} from '../controllers/machineController';

export const machineRoutes = Router();

machineRoutes.get('/', getMachines);
machineRoutes.post('/', postMachine);
machineRoutes.get('/:id', getMachine);
machineRoutes.put('/:id', putMachine);
machineRoutes.delete('/:id', removeMachine);
machineRoutes.get('/:id/series', getMachineSeries);
machineRoutes.get('/:id/status', getMachineStatus);
