import { Router, Request, Response } from 'express';

export const sseRoutes = Router();

// Server-Sent Events for real-time alerts
const clients: Set<Response> = new Set();

sseRoutes.get('/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  clients.add(res);

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  req.on('close', () => {
    clients.delete(res);
  });
});

// Broadcast a message to all connected SSE clients
export function broadcastEvent(event: Record<string, unknown>): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    client.write(data);
  }
}

export function getSseClientCount(): number {
  return clients.size;
}
