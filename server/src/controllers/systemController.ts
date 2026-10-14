import { Request, Response } from 'express';

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
