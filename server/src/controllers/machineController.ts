import { Request, Response } from 'express';
import {
  getMachines as fetchMachines,
  getMachineById,
  getMachineSeries as fetchSeries,
  getMachineStatus as fetchStatus,
  createMachine,
  updateMachine,
  deleteMachine,
} from '../services/machineService';
import { inspectToolImage } from '../utils/ai';

export async function getMachines(_req: Request, res: Response) {
  const machines = fetchMachines();
  res.json(machines);
}

export async function getMachine(req: Request, res: Response) {
  const machine = getMachineById(req.params.id);
  if (!machine) {
    res.status(404).json({ error: 'Machine not found' });
    return;
  }
  res.json(machine);
}

export async function getMachineSeries(req: Request, res: Response) {
  const { id } = req.params;
  const from = req.query.from ? parseInt(req.query.from as string) : 0;
  const to = req.query.to ? parseInt(req.query.to as string) : undefined;
  const series = fetchSeries(id, from, to);
  if (!series) {
    res.status(404).json({ error: 'Machine not found' });
    return;
  }
  res.json(series);
}

export async function getMachineStatus(req: Request, res: Response) {
  const status = fetchStatus(req.params.id);
  if (!status) {
    res.status(404).json({ error: 'Machine not found' });
    return;
  }
  res.json(status);
}

const DEFAULT_WARNING = 5;
const DEFAULT_CRITICAL = 10;

export async function postMachine(req: Request, res: Response) {
  const { id, name, type, basePower } = req.body;
  if (!id || !name || !type) {
    res.status(400).json({ error: 'id, name and type are required' });
    return;
  }

  // Thresholds are set later in the dedicated Threshold tab, not at creation.
  const thresholds = {
    upperAlarm: DEFAULT_CRITICAL,
    upperWarning: DEFAULT_WARNING,
    lowerWarning: -DEFAULT_WARNING,
    lowerAlarm: -DEFAULT_CRITICAL,
  };

  const result = createMachine({ id, name, type, thresholds, basePower });
  if ('error' in result) {
    res.status(409).json(result);
    return;
  }
  res.status(201).json(result);
}

export async function putMachine(req: Request, res: Response) {
  const { name, type, thresholds } = req.body;
  const machine = updateMachine(req.params.id, { name, type, thresholds });
  if (!machine) {
    res.status(404).json({ error: 'Machine not found' });
    return;
  }
  res.json(machine);
}

export async function removeMachine(req: Request, res: Response) {
  const deleted = deleteMachine(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Machine not found' });
    return;
  }
  res.status(204).send();
}

export async function inspectTool(req: Request, res: Response) {
  try {
    const machine = getMachineById(req.params.id);
    if (!machine) {
      res.status(404).json({ error: 'Machine not found' });
      return;
    }
    const status = fetchStatus(req.params.id);
    // Use the current power deviation as a proxy for tool wear level.
    const wearLevel = status ? Math.min(Math.abs(status.devPct) * 2, 100) : 50;
    const result = await inspectToolImage(req.params.id, wearLevel);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}
