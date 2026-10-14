import { Router } from 'express';
import { ask } from '../controllers/chatController';

export const chatRoutes = Router();

chatRoutes.post('/ask', ask);
