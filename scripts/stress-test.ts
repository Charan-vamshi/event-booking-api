import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = process.env.API_URL || 'https://event-booking-api-fr2b.onrender.com';

// 1. Concurrency levels with CLI override support (e.g. tsx scripts/stress-test.ts 10,25,50)
const cliArgs = process.argv.slice(2);
let concurrencyLevels = [5, 15, 30, 50, 100, 200, 500];

if (cliArgs.length > 0) {
  const parsed = cliArgs
    .flatMap((arg) => arg.split(','))
    .map((val) => parseInt(val.trim(), 10))
    .filter((num) => !isNaN(num) && num > 0);
  if (parsed.length > 0) {
    concurrencyLevels = parsed;
  }
}

interface RequestOutcome {
  status: number;
  latencyMs: number;
  timedOut: boolean;
  error?: string;
}

async function run() {
  console.log(`\n======================================================================`);
  console.log(`  STRESS TEST: EVENT BOOKING API`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Concurrency Levels: ${concurrencyLevels.join(', ')}`);
  console.log(`  Request Timeout: 30 seconds`);
  console.log(`======================================================================\n`);

  // Register & Login Organizer
  const orgEmail = `org_${Date.now()}@test.com`;
  const orgPass = 'pass12345';
  console.log(`[Setup] Creating organizer: ${orgEmail}...`);
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

  // Register & Login Customer
  const custEmail = `cust_${Date.now()}@test.com`;
  const custPass = 'pass12345';
  console.log(`[Setup] Creating customer: ${custEmail}...`);
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

  // Run tests for each concurrency level
  for (const concurrency of concurrencyLevels) {
    // 2. Tickets = half concurrency to ensure high contention
    const totalTickets = Math.max(1, Math.floor(concurrency / 2));

    console.log(`\n----------------------------------------------------------------------`);
    console.log(`Testing Concurrency Level: ${concurrency} simultaneous users`);
    console.log(`Target Event Tickets: ${totalTickets} (Contention ratio: 2 requests per ticket)`);
    console.log(`----------------------------------------------------------------------`);

    // Create fresh event for this concurrency test
    const eventDate = new Date(Date.now() + 86400000 * 7).toISOString();
    let eventId = '';
    try {
      const createRes = await fetch(`${BASE_URL}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${orgToken}`,
        },
        body: JSON.stringify({
          title: `Load Test C-${concurrency}`,
          description: `Contention test with ${concurrency} users for ${totalTickets} tickets`,
          venue: 'Stress Arena',
          event_date: eventDate,
          price: 15,
          total_tickets: totalTickets,
        }),
      });
      const createData = await createRes.json();
      eventId = createData.event.id;
    } catch (err: any) {
      console.error(`Failed to create event for concurrency ${concurrency}:`, err.message);
      continue;
    }

    // 4. Fire concurrent requests with 30s timeout
    const testStartTime = performance.now();

    const requestPromises: Promise<RequestOutcome>[] = Array.from({ length: concurrency }).map(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);
      const reqStart = performance.now();

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
          signal: controller.signal,
        });

        const latencyMs = performance.now() - reqStart;
        return {
          status: res.status,
          latencyMs,
          timedOut: false,
        };
      } catch (err: any) {
        const latencyMs = performance.now() - reqStart;
        const timedOut = err.name === 'AbortError' || controller.signal.aborted;
        return {
          status: 0,
          latencyMs,
          timedOut,
          error: timedOut ? 'Request timed out after 30s' : err.message,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    });

    const results = await Promise.all(requestPromises);
    const totalDurationMs = performance.now() - testStartTime;
    const totalDurationSec = totalDurationMs / 1000;

    // 3. Calculate metrics: RPS, Latency (avg, p95), Success, Sold-out, Errors
    let successCount = 0;
    let soldOutCount = 0;
    let errorCount = 0;
    const latencies: number[] = [];

    for (const r of results) {
      latencies.push(r.latencyMs);
      if (r.status === 201) {
        successCount++;
      } else if (r.status === 400) {
        soldOutCount++;
      } else {
        errorCount++; // 500, network error, or 30s timeout
      }
    }

    latencies.sort((a, b) => a - b);
    const avgLatency = (latencies.reduce((sum, val) => sum + val, 0) / (latencies.length || 1)).toFixed(1);
    const p95Index = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));
    const p95Latency = latencies[p95Index] ? latencies[p95Index].toFixed(1) : '0';
    const rps = (concurrency / (totalDurationSec || 0.001)).toFixed(2);

    // Verify tickets in database
    let finalTicketsInDb = -1;
    try {
      const verifyRes = await fetch(`${BASE_URL}/events/${eventId}`, {
        headers: { Authorization: `Bearer ${custToken}` },
      });
      const verifyData = await verifyRes.json();
      finalTicketsInDb = verifyData.event ? verifyData.event.available_tickets : -1;
    } catch {
      // ignore
    }

    const expectedTicketsInDb = Math.max(0, totalTickets - successCount);

    // Print detailed metrics
    console.log(`Results for Concurrency = ${concurrency}:`);
    console.log(`- Total time:                  ${totalDurationMs.toFixed(0)} ms (${totalDurationSec.toFixed(2)} s)`);
    console.log(`- Requests per second (RPS):   ${rps}`);
    console.log(`- Average latency:             ${avgLatency} ms`);
    console.log(`- p95 latency:                 ${p95Latency} ms`);
    console.log(`- Successes (201):             ${successCount}`);
    console.log(`- Sold-out rejections (400):   ${soldOutCount}`);
    console.log(`- Errors (500 or timeouts):    ${errorCount}`);
    console.log(`- Final tickets in DB:         ${finalTicketsInDb} (Expected: ${expectedTicketsInDb})`);

    // Oversold check
    if (successCount > totalTickets) {
      console.log(`\n🚨 OVERSOLD WARNING: ${successCount} tickets booked, but only ${totalTickets} were available! (Overbooked by ${successCount - totalTickets})`);
    } else {
      console.log(`✅ Integrity verified: No overselling occurred (Sold: ${successCount}/${totalTickets}).`);
    }
  }

  console.log(`\n======================================================================`);
  console.log(`  STRESS TEST RUN COMPLETE`);
  console.log(`======================================================================\n`);
}

run().catch(console.error);
