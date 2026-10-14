import { Request, Response } from 'express';
import { askAssistant } from '../services/chatService';

export async function ask(req: Request, res: Response) {
  const question = (req.body?.question || '').trim();
  if (!question) {
    res.status(400).json({ error: 'question is required' });
    return;
  }
  if (question.length > 500) {
    res.status(400).json({ error: 'question too long (max 500 chars)' });
    return;
  }
  const result = await askAssistant(question);
  res.json(result);
}
