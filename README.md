# Event Booking API

Production-ready backend API for an Event Booking System built with **Node.js**, **Express**, **TypeScript**, and **PostgreSQL (Supabase)**.

Live Deployed URL: **`https://event-booking-api-fr2b.onrender.com`**

---

## 1. System Architecture & Tech Stack

- **Runtime & Language:** Node.js v22 (TypeScript)
- **Web Framework:** Express.js
- **Database:** PostgreSQL (Supabase) using `pg` connection pool with SSL
- **Background Job Queue:** `pg-boss` (Postgres-native transactional queue with exponential backoff and retries)
- **Email Delivery:** Brevo HTTP API (`https://api.brevo.com/v3/smtp/email`) with 15s timeout protection (avoids cloud outbound SMTP port 587 blocks)
- **Security:** JWT authentication, bcrypt password hashing, input validation, UUID primary keys

---

## 2. Role-Based Access Control (RBAC)

Supports two user roles:
1. **Event Organizers:**
   - Create events (`POST /events`)
   - Update event details and capacity (`PUT /events/:id`)
   - Delete events (`DELETE /events/:id`)
   - View their own events (`GET /organizer/events`)
2. **Customers:**
   - Browse upcoming events with pagination (`GET /events?page=1&limit=10`)
   - View single event details (`GET /events/:id`)
   - Book tickets (`POST /bookings`)
   - View personal booking history (`GET /bookings/my`)

---

## 3. Asynchronous Background Tasks

Background processing is decoupled via `pg-boss` worker:
1. **Task 1: Real Booking Confirmation Email**
   - Triggered asynchronously immediately after a customer books tickets.
   - Response returns immediately (HTTP 201) without blocking.
   - Worker fetches booking, customer, and event data and dispatches a rich HTML & text confirmation email.
   - Built with 3 automatic retries and exponential backoff.
2. **Task 2: Event Update Notification**
   - Triggered whenever an organizer updates event date, venue, price, or description.
   - Computes a granular diff (old value → new value).
   - Queries all distinct customers with confirmed bookings for that event.
   - Dispatches individualized update emails with isolated error handling so one failure does not impact others.

---

## 4. Performance, Stress Testing & Concurrency Delta

### Stress Scenario Setup
- Target: 20 available event tickets
- Tested concurrency: 5, 15, 30, and 50 simultaneous booking requests

### Initial (Naive) Implementation vs Optimized (Delta)

| Concurrency Level | Initial Naive Behavior | Optimized (Row Locking + ACID) |
| :--- | :--- | :--- |
| **5 users** | Lost update (DB showed 17 left instead of 15) | **100% accurate (15 left in DB, 0 errors)** |
| **15 users** | **5 requests dropped / crashed (500)** | **100% success (15 confirmed, 0 dropped)** |
| **30 users** | **22 tickets sold (OVERSOLD!), 8 crashed** | **20 sold, 10 clean 400 (Sold Out), 0 crashed** |
| **50 users** | **30 tickets sold (OVERSOLD!), 20 crashed (40% fail rate)** | **20 sold, 30 clean 400 (Sold Out), 0 crashed** |

### Key Optimizations Applied
1. **Row-Level Pessimistic Locking (`SELECT ... FOR UPDATE`):**
   Prevents concurrent transactions from reading stale ticket counts simultaneously.
2. **ACID Transaction Isolation (`BEGIN ... COMMIT / ROLLBACK`):**
   Ensures that ticket decrement and booking insertion are completely atomic. If tickets are insufficient, rollback occurs cleanly.
3. **Connection Pool Tuning:**
   Configured `max: 20`, `idleTimeoutMillis: 30000`, and `connectionTimeoutMillis: 10000` to prevent socket starvation under load spikes.

---

## 5. API Reference

### Auth
- `POST /auth/register` - `{ name, email, password, role: 'organizer' | 'customer' }`
- `POST /auth/login` - `{ email, password }` -> returns `{ token, user }`

### Events
- `GET /health` - Health check
- `GET /events?page=1&limit=10` - List upcoming events (paginated)
- `GET /events/:id` - Get event details
- `POST /events` - Create event (Organizer only)
- `PUT /events/:id` - Update event (Owner only, triggers background email notification)
- `DELETE /events/:id` - Delete event (Owner only)
- `GET /organizer/events` - List organizer's own events

### Bookings
- `POST /bookings` - Book tickets (Customer only, triggers background confirmation email)
- `GET /bookings/my` - View customer's bookings

---

## 6. How to Run Locally

```bash
# 1. Install dependencies
npm install

# 2. Run database migrations
npm run migrate

# 3. Start background queue worker
npm run worker

# 4. Start API server
npm run dev

# 5. Run automated stress test
npm run test:stress
```
