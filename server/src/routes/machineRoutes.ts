import { Router } from 'express';
import {
  getMachines,
  getMachine,
  getMachineSeries,
  getMachineStatus,
  postMachine,
  putMachine,
  removeMachine,
  inspectTool,
} from '../controllers/machineController';

export const machineRoutes = Router();

machineRoutes.get('/', getMachines);
machineRoutes.post('/', postMachine);
machineRoutes.get('/:id', getMachine);
machineRoutes.put('/:id', putMachine);
machineRoutes.delete('/:id', removeMachine);
machineRoutes.get('/:id/series', getMachineSeries);
machineRoutes.get('/:id/status', getMachineStatus);
machineRoutes.post('/:id/inspect-tool', inspectTool);
