import { getBoss, BOOKING_CONFIRMATION_QUEUE, EVENT_UPDATE_NOTIFICATION_QUEUE } from './queue';
import { query } from './db';
import { sendBookingConfirmationEmail, sendEventUpdateEmail } from './services/email.service';

async function startWorker() {
  console.log('[Worker] Starting background worker process...');
  const boss = await getBoss();

  // createQueue is idempotent — safe to call from both API and worker
  await boss.createQueue(BOOKING_CONFIRMATION_QUEUE, {
    retryLimit: 3,
    retryBackoff: true,
  });
  console.log(`[Worker] Queue '${BOOKING_CONFIRMATION_QUEUE}' ready`);

  await boss.createQueue(EVENT_UPDATE_NOTIFICATION_QUEUE, {
    retryLimit: 3,
    retryBackoff: true,
  });
  console.log(`[Worker] Queue '${EVENT_UPDATE_NOTIFICATION_QUEUE}' ready`);

  // ── Booking Confirmation Handler ──
  console.log(`[Worker] Listening for '${BOOKING_CONFIRMATION_QUEUE}' jobs...`);

  await boss.work(BOOKING_CONFIRMATION_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const { bookingId } = job.data as { bookingId: string };
      const attempt = (job.retryCount || 0) + 1;

      console.log(`[Worker] Processing booking-confirmation ${bookingId} (attempt ${attempt}/3)...`);

      const result = await query(
        `SELECT b.id AS booking_id, b.quantity, b.total_price,
                u.name AS customer_name, u.email AS customer_email,
                e.title AS event_title, e.event_date, e.venue
         FROM bookings b
         JOIN users u ON b.user_id = u.id
         JOIN events e ON b.event_id = e.id
         WHERE b.id = $1`,
        [bookingId]
      );

      if (result.rows.length === 0) {
        console.error(`[Worker] ERROR: Booking ${bookingId} not found in database. Skipping.`);
        return;
      }

      const bookingInfo = result.rows[0];

      try {
        await sendBookingConfirmationEmail({
          to: bookingInfo.customer_email,
          customerName: bookingInfo.customer_name,
          eventTitle: bookingInfo.event_title,
          eventDate: bookingInfo.event_date,
          venue: bookingInfo.venue,
          quantity: bookingInfo.quantity,
          totalPrice: bookingInfo.total_price,
          bookingId: bookingInfo.booking_id,
        });

        console.log(`[Worker] SUCCESS: Booking confirmation email sent for booking ${bookingId} to ${bookingInfo.customer_email}`);
      } catch (err: any) {
        console.error(
          `[Worker] ERROR: Failed sending email for booking ${bookingId} to ${bookingInfo.customer_email} (attempt ${attempt}/3):`,
          err.message || err
        );
        throw err;
      }
    }
  });

  // ── Event Update Notification Handler ──
  console.log(`[Worker] Listening for '${EVENT_UPDATE_NOTIFICATION_QUEUE}' jobs...`);

  await boss.work(EVENT_UPDATE_NOTIFICATION_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const { eventId, changes } = job.data as {
        eventId: string;
        changes: { field: string; oldValue: string; newValue: string }[];
      };
      const attempt = (job.retryCount || 0) + 1;

      console.log(`[Worker] Processing event-update-notification for event ${eventId} (attempt ${attempt}/3)...`);

      // Load the updated event details
      const eventResult = await query('SELECT title, event_date, venue FROM events WHERE id = $1', [eventId]);
      if (eventResult.rows.length === 0) {
        console.error(`[Worker] ERROR: Event ${eventId} not found. Skipping.`);
        return;
      }
      const event = eventResult.rows[0];

      // Find all distinct customers with confirmed bookings for this event
      const customersResult = await query(
        `SELECT DISTINCT u.id, u.name, u.email
         FROM bookings b
         JOIN users u ON b.user_id = u.id
         WHERE b.event_id = $1 AND b.status = 'confirmed'`,
        [eventId]
      );

      if (customersResult.rows.length === 0) {
        console.log(`[Worker] No customers with confirmed bookings for event ${eventId}. Skipping.`);
        return;
      }

      console.log(`[Worker] Sending event update emails to ${customersResult.rows.length} customer(s)...`);

      // Send one email per customer; one failure must not block others
      for (const customer of customersResult.rows) {
        try {
          await sendEventUpdateEmail({
            to: customer.email,
            customerName: customer.name,
            eventTitle: event.title,
            eventDate: event.event_date,
            venue: event.venue,
            changes,
          });
          console.log(`[Worker] SUCCESS: Event update email sent for event ${eventId} to ${customer.email}`);
        } catch (err: any) {
          console.error(
            `[Worker] ERROR: Failed sending event update email for event ${eventId} to ${customer.email} (attempt ${attempt}/3):`,
            err.message || err
          );
          // Don't throw — continue to the next customer
        }
      }
    }
  });
}

// Graceful shutdown
const shutdown = async () => {
  console.log('\n[Worker] Shutting down worker process...');
  try {
    const boss = await getBoss();
    await boss.stop();
  } catch (err) {
    console.error('[Worker] Error stopping boss:', err);
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startWorker().catch((err) => {
  console.error('[Worker] Fatal error starting worker:', err);
  process.exit(1);
});
