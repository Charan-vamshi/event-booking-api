import { Request, Response, NextFunction } from 'express';
import { query } from '../db';
import { AppError } from '../middleware/errorHandler';
import { enqueueBookingConfirmation } from '../queue';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// NOTE: Deliberately NAIVE implementation for baseline load testing.
// Suffers from race conditions under concurrency (no DB transaction, no row locks, no atomic decrement).
export const createBooking = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { event_id, quantity } = req.body;
    const userId = req.user?.id;

    if (!event_id || quantity === undefined) {
      throw new AppError('event_id and quantity are required', 400);
    }

    if (!UUID_REGEX.test(event_id)) {
      throw new AppError('Invalid event ID format', 400);
    }

    const parsedQuantity = parseInt(quantity, 10);
    if (isNaN(parsedQuantity) || parsedQuantity <= 0 || !Number.isInteger(Number(quantity))) {
      throw new AppError('quantity must be a positive integer', 400);
    }

    // 1. Read event (Naive: no FOR UPDATE locking)
    const eventResult = await query(
      'SELECT id, title, price, available_tickets FROM events WHERE id = $1',
      [event_id]
    );

    if (eventResult.rows.length === 0) {
      throw new AppError('Event not found', 404);
    }

    const event = eventResult.rows[0];

    // 2. Check availability in JS code (Naive: vulnerable to race condition)
    if (parsedQuantity > event.available_tickets) {
      throw new AppError('Not enough available tickets', 400);
    }

    const totalPrice = Number(event.price) * parsedQuantity;

    // 3. Insert booking (Naive: separate query)
    const bookingResult = await query(
      `INSERT INTO bookings (user_id, event_id, quantity, total_price, status)
       VALUES ($1, $2, $3, $4, 'confirmed')
       RETURNING *`,
      [userId, event_id, parsedQuantity, totalPrice]
    );

    // 4. Update available tickets (Naive: separate non-atomic update)
    const newAvailable = event.available_tickets - parsedQuantity;
    await query(
      'UPDATE events SET available_tickets = $1, updated_at = NOW() WHERE id = $2',
      [newAvailable, event_id]
    );

    const booking = bookingResult.rows[0];

    // 5. Enqueue background job (fire-and-forget: never blocks or fails the booking response)
    enqueueBookingConfirmation(booking.id).catch((err) => {
      console.error('[Queue] Error triggering background enqueue:', err);
    });

    res.status(201).json({
      message: 'Booking confirmed successfully',
      booking,
    });
  } catch (error) {
    next(error);
  }
};

export const getMyBookings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;

    const result = await query(
      `SELECT b.id, b.event_id, b.quantity, b.total_price, b.status, b.created_at,
              e.title AS event_title, e.event_date, e.venue
       FROM bookings b
       JOIN events e ON b.event_id = e.id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC`,
      [userId]
    );

    res.status(200).json({
      bookings: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    next(error);
  }
};
