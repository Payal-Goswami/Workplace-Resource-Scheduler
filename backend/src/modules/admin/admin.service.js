import { pool } from '../../../db/pool.js';
import { ApiError } from '../../utils/apiError.js';

export async function listAdminResources() {
  const { rows } = await pool.query(
    `SELECT id, name, type, capacity, description, image_path,
            block, floor, room_number, is_active, created_at
     FROM resources
     ORDER BY block, floor, room_number`
  );
  return rows;
}

export async function createResource(actorId, input) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO resources
        (name, type, capacity, description, image_path, block, floor, room_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.name,
        input.type,
        input.capacity,
        input.description ?? null,
        input.image_path ?? null,
        input.block,
        input.floor,
        input.room_number,
      ]
    );
    const resource = result.rows[0];

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'RESOURCE_ADDED', 'resource', $2, $3::jsonb)`,
      [
        actorId,
        resource.id,
        JSON.stringify({
          name: resource.name,
          type: resource.type,
          block: resource.block,
          floor: resource.floor,
          room_number: resource.room_number,
        }),
      ]
    );

    await client.query('COMMIT');
    return resource;
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      throw new ApiError(409, 'A resource already exists at this location');
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function getResourceDisableWarning(resourceId) {
  const resourceResult = await pool.query(
    'SELECT id, name, is_active FROM resources WHERE id = $1',
    [resourceId]
  );
  const resource = resourceResult.rows[0];

  if (!resource) {
    throw new ApiError(404, 'Resource not found');
  }

  const { rows } = await pool.query(
    `SELECT b.id,
            b.start_time,
            b.end_time,
            b.booking_type,
            b.attendees,
            u.name AS booker_name,
            u.email AS booker_email,
            u.designation AS booker_designation,
            t.name AS team_name,
            (b.start_time <= now() AND b.end_time > now()) AS in_progress
     FROM bookings b
     JOIN users u ON u.id = b.created_by
     LEFT JOIN teams t ON t.id = b.team_id
     WHERE b.resource_id = $1
       AND b.status = 'CONFIRMED'
       AND b.end_time > now()
     ORDER BY b.start_time`,
    [resourceId]
  );

  const futureBookings = rows.filter((booking) => !booking.in_progress);
  const inProgressBookings = rows.filter((booking) => booking.in_progress);

  return {
    resource,
    count: futureBookings.length,
    bookings: futureBookings,
    inProgressBookings: inProgressBookings.map((booking) => ({
      ...booking,
      inProgress: true,
    })),
  };
}

export async function disableResource(actorId, resourceId, expectedCount) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const resourceResult = await client.query(
      'SELECT id, is_active FROM resources WHERE id = $1 FOR UPDATE',
      [resourceId]
    );
    const resource = resourceResult.rows[0];

    if (!resource) {
      throw new ApiError(404, 'Resource not found');
    }

    const countResult = await client.query(
      `SELECT count(*)::integer AS count
       FROM bookings
       WHERE resource_id = $1
         AND status = 'CONFIRMED'
         AND start_time > now()`,
      [resourceId]
    );
    const currentCount = countResult.rows[0].count;

    if (currentCount !== expectedCount) {
      throw new ApiError(409, 'Warning is stale, please review again');
    }

    await client.query(
      `UPDATE bookings
       SET status = 'CANCELLED',
           cancel_reason = 'RESOURCE_DISABLED',
           cancelled_by = $2,
           cancelled_at = now()
       WHERE resource_id = $1
         AND status = 'CONFIRMED'
         AND start_time > now()`,
      [resourceId, actorId]
    );

    await client.query(
      'UPDATE resources SET is_active = false WHERE id = $1',
      [resourceId]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'RESOURCE_DISABLED', 'resource', $2, $3::jsonb)`,
      [actorId, resourceId, JSON.stringify({ cancelledBookings: currentCount })]
    );

    await client.query('COMMIT');
    return { disabled: true, cancelledBookings: currentCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function enableResource(actorId, resourceId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE resources
       SET is_active = true
       WHERE id = $1
       RETURNING id, is_active`,
      [resourceId]
    );

    if (!result.rows[0]) {
      throw new ApiError(404, 'Resource not found');
    }

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'RESOURCE_ENABLED', 'resource', $2, '{}'::jsonb)`,
      [actorId, resourceId]
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateResource(actorId, resourceId, input) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const currentResult = await client.query(
      'SELECT * FROM resources WHERE id = $1 FOR UPDATE',
      [resourceId]
    );
    const current = currentResult.rows[0];

    if (!current) {
      throw new ApiError(404, 'Resource not found');
    }

    const nextCapacity = input.capacity ?? current.capacity;
    let conflictingBookings = [];

    if (nextCapacity < current.capacity) {
      const conflictsResult = await client.query(
        `SELECT b.id,
                b.start_time,
                b.end_time,
                b.attendees,
                b.booking_type,
                u.name AS booker_name,
                u.email AS booker_email
         FROM bookings b
         JOIN users u ON u.id = b.created_by
         WHERE b.resource_id = $1
           AND b.status = 'CONFIRMED'
           AND b.start_time > now()
           AND b.attendees > $2
         ORDER BY b.start_time`,
        [resourceId, nextCapacity]
      );
      conflictingBookings = conflictsResult.rows;
    }

    if (conflictingBookings.length > 0) {
      throw new ApiError(
        409,
        'Capacity is below the attendee count of future bookings',
        conflictingBookings
      );
    }

    const fields = [
      ['name', input.name],
      ['type', input.type],
      ['capacity', input.capacity],
      ['description', input.description],
      ['image_path', input.image_path],
      ['block', input.block],
      ['floor', input.floor],
      ['room_number', input.room_number],
    ].filter(([, value]) => value !== undefined);

    const values = fields.map(([, value]) => value);
    const assignments = fields.map(([field], index) => `${field} = $${index + 2}`);
    const updateResult = await client.query(
      `UPDATE resources
       SET ${assignments.join(', ')}
       WHERE id = $1
       RETURNING *`,
      [resourceId, ...values]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'RESOURCE_UPDATED', 'resource', $2, $3::jsonb)`,
      [actorId, resourceId, JSON.stringify(input)]
    );
    await client.query('COMMIT');
    return updateResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      throw new ApiError(409, 'A resource already exists at this location');
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function listAdminTeams() {
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.created_at, t.deleted_at,
            u.id AS lead_user_id, u.name AS lead_name, u.email AS lead_email
     FROM teams t
     JOIN users u ON u.id = t.lead_user_id
     ORDER BY t.deleted_at NULLS FIRST, t.name`
  );
  return rows;
}

export async function listAdminBookings() {
  const { rows } = await pool.query(
    `SELECT b.*,
            r.name AS resource_name,
            r.block,
            r.floor,
            r.room_number,
            u.name AS booker_name,
            u.email AS booker_email,
            u.designation AS booker_designation,
            t.name AS team_name
     FROM bookings b
     JOIN resources r ON r.id = b.resource_id
     JOIN users u ON u.id = b.created_by
     LEFT JOIN teams t ON t.id = b.team_id
     ORDER BY b.start_time DESC
     LIMIT 500`
  );
  return rows;
}
