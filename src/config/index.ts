import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 5000,
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'default_fallback_secret_key',
  brevoApiKey: process.env.BREVO_API_KEY || '',
  mailFrom: process.env.MAIL_FROM || 'noreply@eventbooking.com',
};

if (!process.env.JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET environment variable is not set. Using default secret.');
}
