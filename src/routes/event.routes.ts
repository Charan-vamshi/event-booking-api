import { Router } from 'express';
import {
  createEvent,
  updateEvent,
  deleteEvent,
  getEvents,
  getEventById,
} from '../controllers/event.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// Public / Customer routes (authenticated, any role)
router.get('/', authenticate, getEvents);
router.get('/:id', authenticate, getEventById);

// Organizer routes (authenticated, organizer role only)
router.post('/', authenticate, authorize('organizer'), createEvent);
router.put('/:id', authenticate, authorize('organizer'), updateEvent);
router.delete('/:id', authenticate, authorize('organizer'), deleteEvent);

export default router;
