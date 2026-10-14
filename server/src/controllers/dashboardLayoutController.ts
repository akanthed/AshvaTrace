import { Request, Response } from 'express';
import { upsertDashboardLayout, queryDashboardLayout } from '../services/bigqueryService';

export async function getDashboardLayout(req: Request, res: Response) {
  const layout = await queryDashboardLayout(req.params.machineId);
  if (!layout) {
    res.json({ machineId: req.params.machineId, imageDataUrl: null, tileXPct: null, tileYPct: null, locked: false });
    return;
  }
  res.json({
    machineId: layout.machine_id,
    imageDataUrl: layout.image_data_url,
    tileXPct: layout.tile_x_pct,
    tileYPct: layout.tile_y_pct,
    locked: !!layout.locked,
  });
}

export async function putDashboardLayout(req: Request, res: Response) {
  const { imageDataUrl, tileXPct, tileYPct, locked } = req.body;
  if (imageDataUrl && typeof imageDataUrl === 'string' && !imageDataUrl.startsWith('data:image/')) {
    res.status(400).json({ error: 'imageDataUrl must be a data:image/* URL' });
    return;
  }

  await upsertDashboardLayout({
    machineId: req.params.machineId,
    imageDataUrl,
    tileXPct,
    tileYPct,
    locked,
  });
  res.json({ machineId: req.params.machineId, imageDataUrl, tileXPct, tileYPct, locked: !!locked });
}
