import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// Test route: customer only
router.get('/ping', authenticate, authorize('customer'), (req: Request, res: Response) => {
  res.status(200).json({
    message: 'pong (customer)',
    user: req.user,
  });
});

export default router;
