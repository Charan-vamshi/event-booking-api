import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { getOrganizerEvents } from '../controllers/event.controller';

const router = Router();

// Test route: organizer only
router.get('/ping', authenticate, authorize('organizer'), (req: Request, res: Response) => {
  res.status(200).json({
    message: 'pong (organizer)',
    user: req.user,
  });
});

// List only organizer's events
router.get('/events', authenticate, authorize('organizer'), getOrganizerEvents);

export default router;
