import { Request, Response, NextFunction } from 'express';
import { query } from '../db';
import { AppError } from '../middleware/errorHandler';
import { enqueueEventUpdateNotification, ChangeSummary } from '../queue';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const createEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { title, description, venue, event_date, price, total_tickets } = req.body;
    const organizerId = req.user?.id;

    if (!title || !description || !venue || !event_date || price === undefined || total_tickets === undefined) {
      throw new AppError('title, description, venue, event_date, price, and total_tickets are required', 400);
    }

    const parsedPrice = Number(price);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      throw new AppError('price must be a non-negative number', 400);
    }

    const parsedTotal = parseInt(total_tickets, 10);
    if (isNaN(parsedTotal) || parsedTotal <= 0 || !Number.isInteger(Number(total_tickets))) {
      throw new AppError('total_tickets must be a positive integer', 400);
    }

    const date = new Date(event_date);
    if (isNaN(date.getTime())) {
      throw new AppError('Invalid event_date format', 400);
    }
    if (date.getTime() <= Date.now()) {
      throw new AppError('event_date must be in the future', 400);
    }

    const result = await query(
      `INSERT INTO events (organizer_id, title, description, venue, event_date, price, total_tickets, available_tickets)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING *`,
      [organizerId, title.trim(), description.trim(), venue.trim(), date.toISOString(), parsedPrice, parsedTotal]
    );

    res.status(201).json({
      message: 'Event created successfully',
      event: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

export const updateEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const organizerId = req.user?.id;

    if (!UUID_REGEX.test(id)) {
      throw new AppError('Invalid event ID format', 400);
    }

    const existingResult = await query('SELECT * FROM events WHERE id = $1', [id]);
    if (existingResult.rows.length === 0) {
      throw new AppError('Event not found', 404);
    }

    const existingEvent = existingResult.rows[0];
    if (existingEvent.organizer_id !== organizerId) {
      throw new AppError('Forbidden: You do not own this event', 403);
    }

    const { title, description, venue, event_date, price, total_tickets } = req.body;

    let updatedTitle = existingEvent.title;
    let updatedDescription = existingEvent.description;
    let updatedVenue = existingEvent.venue;
    let updatedDate = existingEvent.event_date;
    let updatedPrice = existingEvent.price;
    let updatedTotal = existingEvent.total_tickets;
    let updatedAvailable = existingEvent.available_tickets;

    if (title !== undefined) {
      if (!title.trim()) throw new AppError('title cannot be empty', 400);
      updatedTitle = title.trim();
    }

    if (description !== undefined) {
      if (!description.trim()) throw new AppError('description cannot be empty', 400);
      updatedDescription = description.trim();
    }

    if (venue !== undefined) {
      if (!venue.trim()) throw new AppError('venue cannot be empty', 400);
      updatedVenue = venue.trim();
    }

    if (event_date !== undefined) {
      const date = new Date(event_date);
      if (isNaN(date.getTime())) throw new AppError('Invalid event_date format', 400);
      if (date.getTime() <= Date.now()) throw new AppError('event_date must be in the future', 400);
      updatedDate = date.toISOString();
    }

    if (price !== undefined) {
      const parsedPrice = Number(price);
      if (isNaN(parsedPrice) || parsedPrice < 0) throw new AppError('price must be a non-negative number', 400);
      updatedPrice = parsedPrice;
    }

    if (total_tickets !== undefined) {
      const parsedTotal = parseInt(total_tickets, 10);
      if (isNaN(parsedTotal) || parsedTotal <= 0 || !Number.isInteger(Number(total_tickets))) {
        throw new AppError('total_tickets must be a positive integer', 400);
      }
      const diff = parsedTotal - existingEvent.total_tickets;
      const newAvailable = existingEvent.available_tickets + diff;
      if (newAvailable < 0) {
        throw new AppError('Cannot reduce total_tickets below already booked tickets count', 400);
      }
      updatedTotal = parsedTotal;
      updatedAvailable = newAvailable;
    }

    const result = await query(
      `UPDATE events
       SET title = $1, description = $2, venue = $3, event_date = $4, price = $5,
           total_tickets = $6, available_tickets = $7, updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [updatedTitle, updatedDescription, updatedVenue, updatedDate, updatedPrice, updatedTotal, updatedAvailable, id]
    );

    const updatedEvent = result.rows[0];

    // Build change summary comparing old vs new values
    const changes: ChangeSummary[] = [];
    if (title !== undefined && existingEvent.title !== updatedTitle) {
      changes.push({ field: 'title', oldValue: existingEvent.title, newValue: updatedTitle });
    }
    if (description !== undefined && existingEvent.description !== updatedDescription) {
      changes.push({ field: 'description', oldValue: existingEvent.description, newValue: updatedDescription });
    }
    if (venue !== undefined && existingEvent.venue !== updatedVenue) {
      changes.push({ field: 'venue', oldValue: existingEvent.venue, newValue: updatedVenue });
    }
    if (event_date !== undefined && new Date(existingEvent.event_date).toISOString() !== updatedDate) {
      changes.push({ field: 'event_date', oldValue: new Date(existingEvent.event_date).toISOString(), newValue: updatedDate });
    }
    if (price !== undefined && String(existingEvent.price) !== String(updatedPrice)) {
      changes.push({ field: 'price', oldValue: String(existingEvent.price), newValue: String(updatedPrice) });
    }
    if (total_tickets !== undefined && existingEvent.total_tickets !== updatedTotal) {
      changes.push({ field: 'total_tickets', oldValue: String(existingEvent.total_tickets), newValue: String(updatedTotal) });
    }

    // Enqueue notification only if something actually changed (fire-and-forget)
    if (changes.length > 0) {
      enqueueEventUpdateNotification(id, changes).catch((err) => {
        console.error('[Queue] Error triggering event-update enqueue:', err);
      });
    }

    res.status(200).json({
      message: 'Event updated successfully',
      event: updatedEvent,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteEvent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const organizerId = req.user?.id;

    if (!UUID_REGEX.test(id)) {
      throw new AppError('Invalid event ID format', 400);
    }

    const existingResult = await query('SELECT * FROM events WHERE id = $1', [id]);
    if (existingResult.rows.length === 0) {
      throw new AppError('Event not found', 404);
    }

    const existingEvent = existingResult.rows[0];
    if (existingEvent.organizer_id !== organizerId) {
      throw new AppError('Forbidden: You do not own this event', 403);
    }

    await query('DELETE FROM events WHERE id = $1', [id]);

    res.status(200).json({
      message: 'Event deleted successfully',
      deletedEventId: id,
    });
  } catch (error) {
    next(error);
  }
};

export const getOrganizerEvents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const organizerId = req.user?.id;
    const result = await query(
      'SELECT * FROM events WHERE organizer_id = $1 ORDER BY event_date ASC',
      [organizerId]
    );

    res.status(200).json({
      events: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    next(error);
  }
};

export const getEvents = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
    const offset = (page - 1) * limit;

    const countResult = await query(
      'SELECT COUNT(*) FROM events WHERE event_date >= NOW()'
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const result = await query(
      `SELECT id, organizer_id, title, description, venue, event_date, price, total_tickets, available_tickets, created_at, updated_at
       FROM events
       WHERE event_date >= NOW()
       ORDER BY event_date ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.status(200).json({
      events: result.rows,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getEventById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    if (!UUID_REGEX.test(id)) {
      throw new AppError('Invalid event ID format', 400);
    }

    const result = await query('SELECT * FROM events WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      throw new AppError('Event not found', 404);
    }

    res.status(200).json({
      event: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};
