import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.env.API_URL || 'https://event-booking-api-fr2b.onrender.com';

interface TestResult {
  concurrency: number;
  totalRequests: number;
  successCount: number;
  soldOutCount: number;
  failedCount: number;
  durationMs: number;
  oversold: boolean;
  finalAvailableTickets: number;
}

async function run() {
  console.log(`\n==================================================`);
  console.log(`  STRESS TEST: EVENT BOOKING API`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`==================================================\n`);

  // 1. Register & Login Organizer
  const orgEmail = `org_${Date.now()}@test.com`;
  const orgPass = 'pass12345';
  console.log(`[1] Creating organizer: ${orgEmail}...`);
  await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Stress Organizer', email: orgEmail, password: orgPass, role: 'organizer' }),
  });

  const orgLoginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: orgEmail, password: orgPass }),
  });
  const { token: orgToken } = await orgLoginRes.json();

  // 2. Register & Login Customer
  const custEmail = `cust_${Date.now()}@test.com`;
  const custPass = 'pass12345';
  console.log(`[2] Creating customer: ${custEmail}...`);
  await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Stress Customer', email: custEmail, password: custPass, role: 'customer' }),
  });

  const custLoginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: custEmail, password: custPass }),
  });
  const { token: custToken } = await custLoginRes.json();

  // Run tests at increasing concurrency levels
  const concurrencyLevels = [5, 15, 30, 50];
  const TOTAL_TICKETS = 20;

  for (const concurrency of concurrencyLevels) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Testing Concurrency Level: ${concurrency} simultaneous users`);
    console.log(`Target Event Tickets: ${TOTAL_TICKETS}`);
    console.log(`--------------------------------------------------`);

    // Create a fresh event with 20 tickets
    const eventDate = new Date(Date.now() + 86400000 * 7).toISOString();
    const createRes = await fetch(`${BASE_URL}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${orgToken}`,
      },
      body: JSON.stringify({
        title: `Stress Event C-${concurrency}`,
        description: 'Load test event',
        venue: 'Load Test Arena',
        event_date: eventDate,
        price: 10,
        total_tickets: TOTAL_TICKETS,
      }),
    });
    const { event } = await createRes.json();
    const eventId = event.id;

    // Fire `concurrency` booking requests simultaneously
    const startTime = Date.now();
    const requests = Array.from({ length: concurrency }).map(async () => {
      try {
        const res = await fetch(`${BASE_URL}/bookings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${custToken}`,
          },
          body: JSON.stringify({
            event_id: eventId,
            quantity: 1,
          }),
        });

        const status = res.status;
        const data = await res.json().catch(() => ({}));
        return { status, data };
      } catch (err: any) {
        return { status: 0, error: err.message };
      }
    });

    const results = await Promise.all(requests);
    const durationMs = Date.now() - startTime;

    let successCount = 0;
    let soldOutCount = 0;
    let failedCount = 0;

    for (const r of results) {
      if (r.status === 201) successCount++;
      else if (r.status === 400) soldOutCount++;
      else failedCount++; // 500, network error, or dropped
    }

    // Verify final tickets in database
    const verifyRes = await fetch(`${BASE_URL}/events/${eventId}`, {
      headers: { Authorization: `Bearer ${custToken}` },
    });
    const verifyData = await verifyRes.json();
    const finalAvailable = verifyData.event ? verifyData.event.available_tickets : -1;

    console.log(`\nResults for Concurrency = ${concurrency}:`);
    console.log(`- Time taken: ${durationMs}ms`);
    console.log(`- Successful Bookings (201): ${successCount}`);
    console.log(`- Rejected Gracefully (400 Sold Out): ${soldOutCount}`);
    console.log(`- Dropped / Server Errors (500 / Crash): ${failedCount}`);
    console.log(`- Final Available Tickets in DB: ${finalAvailable} (Expected: ${Math.max(0, TOTAL_TICKETS - successCount)})`);

    if (failedCount > 0) {
      console.log(`⚠️ BREAKING POINT HIT: ${failedCount} requests dropped or crashed under ${concurrency} concurrent requests!`);
    } else {
      console.log(`✅ Handled cleanly.`);
    }
  }

  console.log(`\n==================================================`);
  console.log(`  STRESS TEST FINISHED`);
  console.log(`==================================================\n`);
}

run().catch(console.error);
