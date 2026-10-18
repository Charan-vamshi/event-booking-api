import { PgBoss } from 'pg-boss';
import { config } from '../config';

let bossInstance: PgBoss | null = null;
let startPromise: Promise<PgBoss> | null = null;

export const BOOKING_CONFIRMATION_QUEUE = 'booking-confirmation';
export const EVENT_UPDATE_NOTIFICATION_QUEUE = 'event-update-notification';

export async function getBoss(): Promise<PgBoss> {
  if (bossInstance) {
    return bossInstance;
  }

  if (startPromise) {
    return startPromise;
  }

  const isLocalhost =
    config.databaseUrl.includes('localhost') ||
    config.databaseUrl.includes('127.0.0.1');

  bossInstance = new PgBoss({
    connectionString: config.databaseUrl,
    ssl: isLocalhost || !config.databaseUrl ? false : { rejectUnauthorized: false },
  });

  bossInstance.on('error', (err) => {
    console.error('[pg-boss] Error:', err);
  });

  startPromise = bossInstance.start().then(async () => {
    // createQueue is idempotent — safe to call from both API and worker
    await bossInstance!.createQueue(BOOKING_CONFIRMATION_QUEUE, {
      retryLimit: 3,
      retryBackoff: true,
    });
    console.log(`[pg-boss] Queue '${BOOKING_CONFIRMATION_QUEUE}' ready`);

    await bossInstance!.createQueue(EVENT_UPDATE_NOTIFICATION_QUEUE, {
      retryLimit: 3,
      retryBackoff: true,
    });
    console.log(`[pg-boss] Queue '${EVENT_UPDATE_NOTIFICATION_QUEUE}' ready`);

    return bossInstance!;
  });

  return startPromise;
}

export async function enqueueBookingConfirmation(bookingId: string): Promise<void> {
  try {
    const boss = await getBoss();
    const jobId = await boss.send(
      BOOKING_CONFIRMATION_QUEUE,
      { bookingId },
    );
    console.log(`[Queue] Enqueued '${BOOKING_CONFIRMATION_QUEUE}' for booking ${bookingId} (jobId: ${jobId})`);
  } catch (error: any) {
    // A failed enqueue must never fail the booking
    console.error(`[Queue] Failed to enqueue booking-confirmation for ${bookingId}:`, error?.message || error);
  }
}

export interface ChangeSummary {
  field: string;
  oldValue: string;
  newValue: string;
}

export async function enqueueEventUpdateNotification(eventId: string, changes: ChangeSummary[]): Promise<void> {
  try {
    const boss = await getBoss();
    const jobId = await boss.send(
      EVENT_UPDATE_NOTIFICATION_QUEUE,
      { eventId, changes },
    );
    console.log(`[Queue] Enqueued '${EVENT_UPDATE_NOTIFICATION_QUEUE}' for event ${eventId} (jobId: ${jobId})`);
  } catch (error: any) {
    // A failed enqueue must never fail the update
    console.error(`[Queue] Failed to enqueue event-update-notification for ${eventId}:`, error?.message || error);
  }
}
