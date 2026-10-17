import { Request, Response } from 'express';
import { resetDemo } from '../services/incidentService';
import { broadcastEvent } from '../routes/sseRoutes';

export async function getSystemStatus(_req: Request, res: Response) {
  res.json({
    ai: {
      configured: !!process.env.GCP_PROJECT_ID,
      model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      location: process.env.GCP_LOCATION || 'us-central1',
    },
    bigquery: {
      configured: !!process.env.GCP_PROJECT_ID,
      dataset: process.env.BIGQUERY_DATASET || 'ashvatrace',
    },
    pubsub: {
      configured: !!process.env.PUBSUB_ALERT_TOPIC,
      topic: process.env.PUBSUB_ALERT_TOPIC || null,
    },
    simulatedData: true,
  });
}

// Restore the sample problems so the demo can be run again from the start.
export async function resetDemoData(_req: Request, res: Response) {
  const result = resetDemo();
  broadcastEvent({ type: 'demoReset' });
  res.json(result);
}
