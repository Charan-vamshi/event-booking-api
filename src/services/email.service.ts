import { config } from '../config';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const TIMEOUT_MS = 15_000;

async function brevoSend(payload: {
  to: { email: string; name: string }[];
  subject: string;
  htmlContent: string;
  textContent: string;
}): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': config.brevoApiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'Event Booking System', email: config.mailFrom },
        to: payload.to,
        subject: payload.subject,
        htmlContent: payload.htmlContent,
        textContent: payload.textContent,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Brevo API ${res.status}: ${body}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export interface BookingEmailData {
  to: string;
  customerName: string;
  eventTitle: string;
  eventDate: string | Date;
  venue: string;
  quantity: number;
  totalPrice: number | string;
  bookingId: string;
}

export async function sendBookingConfirmationEmail(data: BookingEmailData): Promise<void> {
  const formattedDate = new Date(data.eventDate).toLocaleString();

  await brevoSend({
    to: [{ email: data.to, name: data.customerName }],
    subject: `Booking Confirmed: ${data.eventTitle}`,
    htmlContent: `
      <h2>Booking Confirmation</h2>
      <p>Hi ${data.customerName},</p>
      <p>Your tickets have been confirmed! Here are the event details:</p>
      <ul>
        <li><strong>Event:</strong> ${data.eventTitle}</li>
        <li><strong>Date & Time:</strong> ${formattedDate}</li>
        <li><strong>Venue:</strong> ${data.venue}</li>
        <li><strong>Quantity:</strong> ${data.quantity}</li>
        <li><strong>Total Price:</strong> $${Number(data.totalPrice).toFixed(2)}</li>
        <li><strong>Booking ID:</strong> ${data.bookingId}</li>
      </ul>
      <p>Thank you for booking with us!</p>
    `,
    textContent: `Booking Confirmation\n\nHi ${data.customerName},\n\nYour tickets have been confirmed!\nEvent: ${data.eventTitle}\nDate & Time: ${formattedDate}\nVenue: ${data.venue}\nQuantity: ${data.quantity}\nTotal Price: $${Number(data.totalPrice).toFixed(2)}\nBooking ID: ${data.bookingId}`,
  });
}

export interface EventUpdateEmailData {
  to: string;
  customerName: string;
  eventTitle: string;
  eventDate: string | Date;
  venue: string;
  changes: { field: string; oldValue: string; newValue: string }[];
}

export async function sendEventUpdateEmail(data: EventUpdateEmailData): Promise<void> {
  const formattedDate = new Date(data.eventDate).toLocaleString();

  const changesHtml = data.changes
    .map((c) => `<li><strong>${c.field}:</strong> ${c.oldValue} → ${c.newValue}</li>`)
    .join('\n');

  const changesText = data.changes
    .map((c) => `  ${c.field}: ${c.oldValue} → ${c.newValue}`)
    .join('\n');

  await brevoSend({
    to: [{ email: data.to, name: data.customerName }],
    subject: `Event Updated: ${data.eventTitle}`,
    htmlContent: `
      <h2>Event Update Notification</h2>
      <p>Hi ${data.customerName},</p>
      <p>An event you have booked has been updated. Here are the current details:</p>
      <ul>
        <li><strong>Event:</strong> ${data.eventTitle}</li>
        <li><strong>Date & Time:</strong> ${formattedDate}</li>
        <li><strong>Venue:</strong> ${data.venue}</li>
      </ul>
      <h3>What changed:</h3>
      <ul>
        ${changesHtml}
      </ul>
      <p>If you have any questions, please contact the event organizer.</p>
    `,
    textContent: `Event Update Notification\n\nHi ${data.customerName},\n\nAn event you have booked has been updated.\nEvent: ${data.eventTitle}\nDate & Time: ${formattedDate}\nVenue: ${data.venue}\n\nWhat changed:\n${changesText}`,
  });
}
