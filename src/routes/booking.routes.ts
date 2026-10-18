import { Router } from 'express';
import { createBooking, getMyBookings } from '../controllers/booking.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// Customer only routes
router.post('/', authenticate, authorize('customer'), createBooking);
router.get('/my', authenticate, authorize('customer'), getMyBookings);

export default router;
