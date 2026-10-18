# Event Booking API

A production-grade backend API for an Event Booking System with role-based access control (RBAC), asynchronous background jobs for real email delivery, and atomic concurrency handling to eliminate race conditions and overselling.

- **Live Deployed API URL:** `https://event-booking-api-fr2b.onrender.com`

---

## 1. System Architecture

Built with **Node.js (v22)**, **Express**, and **TypeScript**, backed by **Supabase PostgreSQL**. Background jobs run on `pg-boss` directly on Postgres (no Redis infrastructure needed), and email delivery is handled over Brevo's HTTPS API.

```
+-----------------------------------------------------------------------------------+
|                                Render Web Service                                 |
|                                                                                   |
|  +--------------------+        enqueues job        +---------------------------+  |
|  | Express API Server | -------------------------> | pg-boss (Job Queue Engine)|  |
|  | (Auth, Events,     |                            | (Persistent in Postgres)  |  |
|  |  Bookings)         |                            +---------------------------+  |
|  +--------------------+                                          |                |
|           |                                                      | claims job     |
|           |                                                      v                |
|           | queries                              +---------------------------+    |
|           |                                      | Worker (Background Jobs)  |    |
|           |                                      | - Booking Confirmations   |    |
|           |                                      | - Event Update Broadcasts |    |
|           |                                      +---------------------------+    |
|           |                                                      |                |
+-----------|------------------------------------------------------|----------------+
            | (Transaction Pooler: 6543)                           | HTTPS (Port 443)
            v                                                      v
+-------------------------------+                     +-------------------------+
|      Supabase PostgreSQL     |                     |     Brevo HTTP API      |
|  - users                      |                     |  (/v3/smtp/email)       |
|  - events                     |                     |                         |
|  - bookings                   |                     |  Dispatches real emails |
|  - pgboss.* tables            |                     |  to customers           |
+-------------------------------+                     +-------------------------+
```

---

## 2. API Endpoints & Role Access

Access is governed by JWT authentication (`authenticate`) and role authorization (`authorize`):
- **Event Organizers:** Manage events (create, edit, delete, view own).
- **Customers:** Browse events and book tickets.

| Method | Endpoint | Access Role | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Public | Service health check |
| `POST` | `/auth/register` | Public | Register user (`organizer` or `customer`) |
| `POST` | `/auth/login` | Public | Authenticate and receive JWT token |
| `GET` | `/events` | Authenticated (Any) | Browse upcoming events with pagination (`?page=1&limit=10`) |
| `GET` | `/events/:id` | Authenticated (Any) | View single event details and remaining tickets |
| `POST` | `/events` | Organizer Only | Create a new event |
| `PUT` | `/events/:id` | Organizer (Owner) | Update event details (triggers customer email broadcast) |
| `DELETE` | `/events/:id` | Organizer (Owner) | Delete an event |
| `GET` | `/organizer/events` | Organizer Only | List only events created by the logged-in organizer |
| `POST` | `/bookings` | Customer Only | Book tickets atomically (triggers confirmation email) |
| `GET` | `/bookings/my` | Customer Only | List logged-in customer's booking history |

### Example Requests

#### 1. Register User
```bash
POST /auth/register
Content-Type: application/json

{
  "name": "Jane Organizer",
  "email": "jane@example.com",
  "password": "securepassword123",
  "role": "organizer"
}
```

#### 2. Create Event (Organizer)
```bash
POST /events
Authorization: Bearer <ORGANIZER_TOKEN>
Content-Type: application/json

{
  "title": "Cloud Computing Summit 2026",
  "description": "Annual cloud architecture conference",
  "venue": "Convention Center Hall B",
  "event_date": "2026-11-20T10:00:00.000Z",
  "price": 49.99,
  "total_tickets": 100
}
```

#### 3. Book Tickets (Customer)
```bash
POST /bookings
Authorization: Bearer <CUSTOMER_TOKEN>
Content-Type: application/json

{
  "event_id": "7b89d6e2-2a78-43d9-959c-70e6c5354e60",
  "quantity": 2
}
```

---

## 3. Database Schema

Managed via explicit SQL migrations in `src/db/migrations/`:

```sql
-- 1. Users Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('organizer', 'customer')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 2. Events Table
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organizer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    venue VARCHAR(255) NOT NULL,
    event_date TIMESTAMPTZ NOT NULL,
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    total_tickets INT NOT NULL CHECK (total_tickets > 0),
    available_tickets INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_tickets CHECK (available_tickets >= 0 AND available_tickets <= total_tickets)
);

-- 3. Bookings Table
CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    quantity INT NOT NULL CHECK (quantity > 0),
    total_price NUMERIC(10, 2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

---

## 4. Key Design Decisions & Rationale

1. **JWT Authentication & Strict Error Boundaries (401 vs 403):**  
   - `401 Unauthorized` is strictly reserved for missing, invalid, or expired tokens.  
   - `403 Forbidden` is returned when a valid authenticated user attempts an operation restricted to another role (e.g., customer attempting `POST /events` or organizer editing an event owned by another organizer).

2. **pg-boss Queue over Redis:**  
   - Running Redis requires separate infrastructure, credentials, and network boundaries.  
   - `pg-boss` uses existing PostgreSQL tables and transactional guarantees, supports automatic schema migrations, and provides 3 automatic retries with exponential backoff out of the box.

3. **Single Render Web Service with Internal Background Worker:**  
   - Render's Free Tier does not offer separate background worker services.  
   - Both the Express API and the worker run concurrently in the web service process. UptimeRobot pings `/health` every 5 minutes to prevent container cold sleeps.

4. **Brevo HTTP API instead of SMTP:**  
   - Outbound SMTP connections (ports 25, 465, 587) are blocked or throttled by cloud container environments like Render, causing Nodemailer SMTP to hang indefinitely until timeout.  
   - Switching to Brevo's HTTPS REST API (`https://api.brevo.com/v3/smtp/email`) with a 15-second `AbortController` timeout solved this cleanly.

5. **Quota Protection for Load Testing:**  
   - The worker automatically skips email dispatch for recipient addresses ending in `@test.com`, logging `[Worker] SKIPPED (test address)`. This prevents automated load test runs from exhausting the daily Brevo email quota.

6. **Isolated Event Update Fanout:**  
   - When an event is updated, the worker queries all distinct customers who have confirmed bookings.  
   - Emails are dispatched individually inside a `try/catch` block so that a network timeout or invalid email address for one customer never prevents notifications to remaining attendees.

7. **Atomic Single-Statement Booking (CTE):**  
   - Traditional "read available tickets -> verify in JS -> update tickets -> insert booking" creates a race condition window where multiple concurrent requests read stale inventory.  
   - We replaced this with a single atomic PostgreSQL CTE query:
     ```sql
     WITH upd AS (
       UPDATE events
       SET available_tickets = available_tickets - $qty, updated_at = NOW()
       WHERE id = $event_id AND available_tickets >= $qty
       RETURNING id, price
     )
     INSERT INTO bookings (user_id, event_id, quantity, total_price)
     SELECT $user_id, upd.id, $qty, upd.price * $qty
     FROM upd
     RETURNING *;
     ```
   - Row-level locking happens inside PostgreSQL engine memory in 1ms. If tickets are insufficient, 0 rows update and 0 rows insert. If 0 rows return, a secondary read checks if the event exists (404) or is sold out (400).

8. **Dual Database Connection Strategy (Pooling vs Session):**  
   - Supabase Free Tier caps direct session connections at 15–20.  
   - App HTTP queries use Supabase's Transaction Pooler (port `6543`, `DATABASE_URL_POOLED`) with `max: 20` and 5s timeout.  
   - `pg-boss` requires direct session connections (`DATABASE_URL`, port `5432`) for `LISTEN`/`NOTIFY` and advisory locks, configured with a minimal pool size (`max: 2`) in the API process.

---

## 5. Performance & Concurrency Benchmarks

### Stress Test Setup & Methodology
- Automated load testing script: [scripts/stress-test.ts](file:///c:/Users/saich/projects/event-booking-api/scripts/stress-test.ts)
- Simulates concurrent bursts of users booking tickets simultaneously.
- Contention model: For every test level $N$, available tickets are set to $\lfloor N / 2 \rfloor$ (2:1 contention ratio).

### Benchmark Comparison (Before vs After)

| Concurrency Level | Naive Implementation (`naive-v1`) | Optimized Implementation (`optimized-v1`) | Delta |
| :--- | :--- | :--- | :--- |
| **5 users** | Handled, but stock discrepancy (17 left instead of 15) | **100% clean (2 sold, 3 remaining, 0 errors)** | Race condition eliminated |
| **15 users** | **6 requests dropped / 500 error** | **7 sold, 8 rejected (400 Sold Out), 0 errors** | 0 dropped requests |
| **30 users** | **12 requests dropped, tickets oversold** | **15 sold, 15 rejected (400 Sold Out), 0 errors** | Zero overselling |
| **50 users** | **19 requests dropped (38% failure rate)** | **25 sold, 25 rejected (400 Sold Out), 0 errors** | 100% reliable |
| **100 users** | *Crashed (EMAXCONNSESSION)* | **50 sold, 50 rejected (400 Sold Out), 0 errors** | Rock-solid inventory |
| **200 users** | *Crashed* | **100 sold, 100 rejected (400 Sold Out), 0 errors** | Clean degradation |
| **500 users** | *Crashed* | **250 sold, 250 rejected (400 Sold Out), 0 errors** | **~93 RPS, p95 latency ~5.2s** |

### Root Causes of Naive Bottlenecks
1. **Lost Updates & Overselling:** Non-atomic read-then-write allowed concurrent requests to evaluate `available_tickets >= quantity` simultaneously against stale cache/reads.
2. **Database Connection Exhaustion (`EMAXCONNSESSION`):** The naive implementation opened and held direct session connections across multi-step transactions, exceeding Supabase's free tier direct connection ceiling.

### Test Caveats
- Tests were executed over a public Internet connection against Render's Free Tier container and Supabase's managed Postgres.
- In the naive benchmark, stock was fixed at 20 tickets; in the optimized benchmark, stock dynamically scaled to half of concurrency to maintain high contention at scale.
- The absolute server capacity ceiling was not breached at 500 users—the atomic CTE continued to maintain 100% inventory accuracy.

---

## 6. How to Run Locally

### Prerequisites
- Node.js v22+
- PostgreSQL database (Supabase or local)
- Brevo API Key

### Environment Variables
Create a `.env` file based on `.env.example`:

```env
PORT
DATABASE_URL
DATABASE_URL_POOLED
JWT_SECRET
BREVO_API_KEY
MAIL_FROM
```

### Setup Steps

```bash
# 1. Install dependencies
npm install

# 2. Run SQL migrations
npm run migrate

# 3. Start the API server
npm run dev

# 4. Start the background worker (in a separate terminal)
npm run worker

# 5. Run the concurrency stress test
npx tsx scripts/stress-test.ts

# Optional: Override concurrency levels for stress testing
npx tsx scripts/stress-test.ts 10,25,50,100
```

---

## 7. Known Limitations & Next Steps

1. **Event Read Caching (Redis):** `GET /events` currently queries PostgreSQL directly. Adding Redis caching with TTL and invalidation on event updates would reduce DB read load.
2. **Rate Limiting:** Protect public `/auth/register` and `/auth/login` endpoints with IP-based rate limiting (`express-rate-limit`).
3. **Decoupled Worker Service:** Move the background worker into a separate container/service in production so CPU spikes from email generation do not impact HTTP API latency.
4. **Token Expiry & Refresh Tokens:** Implement short-lived access tokens (15m) alongside rotating refresh tokens stored in secure `HttpOnly` cookies.
5. **Client Idempotency Keys:** Support `Idempotency-Key` headers on `POST /bookings` to prevent double-charging or duplicate bookings caused by client network retries.

---

## 8. AI Usage Disclosure

This project was designed, implemented, and benchmarked with the assistance of **Google Antigravity** and **Anthropic Claude**, with human review, architectural verification, and continuous testing throughout development.
