import { Request, Response, NextFunction } from 'express';
import { query } from '../db';
import { AppError } from '../middleware/errorHandler';
import { enqueueBookingConfirmation } from '../queue';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Optimization (Atomic CTE Statement for Concurrency):
// Combines conditional ticket decrement and booking insertion into ONE single atomic database round-trip.
// PostgreSQL evaluates `available_tickets >= $qty` with an engine-level row lock on the event.
// If tickets are insufficient, 0 rows are updated and 0 rows are inserted.
// Eliminates race conditions, lost updates, and overselling without application-level locks or holding pool connections.
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

    // Atomic CTE: Decrements tickets ONLY IF available, and inserts booking in the same query
    const bookingResult = await query(
      `WITH upd AS (
         UPDATE events
         SET available_tickets = available_tickets - $1, updated_at = NOW()
         WHERE id = $2 AND available_tickets >= $1
         RETURNING id, price
       )
       INSERT INTO bookings (user_id, event_id, quantity, total_price)
       SELECT $3, upd.id, $1, upd.price * $1
       FROM upd
       RETURNING *`,
      [parsedQuantity, event_id, userId]
    );

    // If zero rows returned, determine if event does not exist or tickets are sold out
    if (bookingResult.rows.length === 0) {
      const checkEvent = await query('SELECT id FROM events WHERE id = $1', [event_id]);
      if (checkEvent.rows.length === 0) {
        throw new AppError('Event not found', 404);
      }
      throw new AppError('Not enough available tickets', 400);
    }

    const booking = bookingResult.rows[0];

    // Asynchronous fire-and-forget background job for email confirmation
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
