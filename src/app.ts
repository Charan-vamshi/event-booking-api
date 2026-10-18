import express, { Application, Request, Response } from 'express';
import authRoutes from './routes/auth.routes';
import organizerRoutes from './routes/organizer.routes';
import customerRoutes from './routes/customer.routes';
import eventRoutes from './routes/event.routes';
import bookingRoutes from './routes/booking.routes';
import { errorHandler } from './middleware/errorHandler';

const app: Application = express();

// Body parser
app.use(express.json());

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Route mounts
app.use('/auth', authRoutes);
app.use('/organizer', organizerRoutes);
app.use('/customer', customerRoutes);
app.use('/events', eventRoutes);
app.use('/bookings', bookingRoutes);

// Fallback for 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Central error handler
app.use(errorHandler);

export default app;
