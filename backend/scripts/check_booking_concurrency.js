import 'dotenv/config';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const users = [];

try {
  const resourceResult = await pool.query(
    'SELECT id FROM resources WHERE is_active = true LIMIT 1'
  );
  const resource = resourceResult.rows[0];

  if (!resource) {
    throw new Error('No active resource available for concurrency check');
  }

  for (let index = 0; index < 10; index += 1) {
    const email = `booking-race-${Date.now()}-${index}@example.com`;
    const password = `BookingRace!${Date.now()}${index}`;

    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: `Race Test ${index + 1}` },
    });

    if (created.error) throw created.error;
    users.push(created.data.user);

    const login = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const session = await login.auth.signInWithPassword({ email, password });
    if (session.error) throw session.error;

    users[index].accessToken = session.data.session.access_token;
  }

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const date = tomorrow.toISOString().slice(0, 10);

  const bookingBody = {
    resourceId: resource.id,
    startTime: `${date}T05:00:00.000Z`,
    endTime: `${date}T05:30:00.000Z`,
    attendees: 1,
    bookingType: 'PERSONAL',
  };

  const responses = await Promise.all(
    users.map((user) =>
      fetch('http://localhost:4000/bookings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bookingBody),
      }).then(async (response) => ({
        status: response.status,
        body: await response.json(),
      }))
    )
  );

  const createdCount = responses.filter((response) => response.status === 201).length;
  const conflictCount = responses.filter((response) => response.status === 409).length;

  console.log(`CREATED=${createdCount}`);
  console.log(`CONFLICTS=${conflictCount}`);

  if (createdCount !== 1 || conflictCount !== 9) {
    throw new Error(
      `Unexpected concurrency result: ${createdCount} created, ${conflictCount} conflicts`
    );
  }
} finally {
  if (users.length > 0) {
    await pool.query(
      'DELETE FROM bookings WHERE created_by = ANY($1::uuid[])',
      [users.map((user) => user.id)]
    );
    await pool.query(
      'DELETE FROM users WHERE id = ANY($1::uuid[])',
      [users.map((user) => user.id)]
    );
  }

  await pool.end();

  for (const user of users) {
    await admin.auth.admin.deleteUser(user.id);
  }
}
