import nodemailer from 'nodemailer';
import { config } from '../config';

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false, // TLS
  auth: {
    user: config.brevoSmtpUser,
    pass: config.brevoSmtpPass,
  },
});

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

  const mailOptions = {
    from: config.mailFrom,
    to: data.to,
    subject: `Booking Confirmed: ${data.eventTitle}`,
    html: `
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
    text: `Booking Confirmation\n\nHi ${data.customerName},\n\nYour tickets have been confirmed!\nEvent: ${data.eventTitle}\nDate & Time: ${formattedDate}\nVenue: ${data.venue}\nQuantity: ${data.quantity}\nTotal Price: $${Number(data.totalPrice).toFixed(2)}\nBooking ID: ${data.bookingId}`,
  };

  await transporter.sendMail(mailOptions);
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

  const mailOptions = {
    from: config.mailFrom,
    to: data.to,
    subject: `Event Updated: ${data.eventTitle}`,
    html: `
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
    text: `Event Update Notification\n\nHi ${data.customerName},\n\nAn event you have booked has been updated.\nEvent: ${data.eventTitle}\nDate & Time: ${formattedDate}\nVenue: ${data.venue}\n\nWhat changed:\n${changesText}`,
  };

  await transporter.sendMail(mailOptions);
}
