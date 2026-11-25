import { pool } from '../../../db/pool.js';
import { ApiError } from '../../utils/apiError.js';

function validateSlotTime(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ApiError(400, 'Invalid booking time');
  }

  if (start <= new Date()) {
    throw new ApiError(400, 'Booking must be in the future');
  }

  if (start >= end) {
    throw new ApiError(400, 'Start time must be before end time');
  }

  const durationMinutes = (end.getTime() - start.getTime()) / 60000;
  if (durationMinutes < 30 || durationMinutes > 240) {
    throw new ApiError(400, 'Duration must be between 30 minutes and 4 hours');
  }

  const latestStart = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  if (start > latestStart) {
    throw new ApiError(400, 'Booking cannot be more than 14 days ahead');
  }

  for (const time of [start, end]) {
    if (
      time.getUTCSeconds() !== 0 ||
      time.getUTCMilliseconds() !== 0 ||
      ![0, 30].includes(time.getUTCMinutes())
    ) {
      throw new ApiError(400, 'Start and end times must use 30-minute boundaries');
    }
  }

  const utcToIstMinutes = (time) =>
    (time.getUTCHours() * 60 + time.getUTCMinutes() + 330) % (24 * 60);

  const istStart = utcToIstMinutes(start);
  const istEnd = utcToIstMinutes(end);

  if (istStart < 540 || istStart >= 1080 || istEnd > 1080) {
    throw new ApiError(400, 'Booking must be within 9:00 AM to 6:00 PM IST');
  }
}

async function validateTeamBooking(client, user, bookingType, teamId) {
  if (bookingType === 'PERSONAL') {
    if (teamId) {
      throw new ApiError(400, 'Personal bookings cannot have a team');
    }
    return;
  }

  if (bookingType === 'GROUP_EVENT' && teamId) {
    throw new ApiError(400, 'Group Event bookings cannot have a team');
  }

  if (user.role !== 'FACILITY_ADMIN') {
    if (!teamId) {
      throw new ApiError(403, 'Only team leads or admins can create this booking');
    }

    const { rows } = await client.query(
      `SELECT t.id
       FROM teams t
       JOIN team_memberships tm
         ON tm.team_id = t.id
        AND tm.user_id = $2
        AND tm.removed_at IS NULL
       WHERE t.id = $1
         AND t.deleted_at IS NULL
         AND t.lead_user_id = $2`,
      [teamId, user.id]
    );

    if (!rows[0]) {
      throw new ApiError(403, 'Only the team lead or admin can create this booking');
    }
  }

  if (bookingType === 'TEAM' && !teamId) {
    throw new ApiError(400, 'Team booking requires a team');
  }

  if (teamId) {
    const { rows } = await client.query(
      'SELECT id FROM teams WHERE id = $1 AND deleted_at IS NULL',
      [teamId]
    );

    if (!rows[0]) {
      throw new ApiError(404, 'Team not found');
    }
  }
}

export async function validateBookingRules(user, input) {
  validateSlotTime(input.startTime, input.endTime);
  await validateTeamBooking(pool, user, input.bookingType, input.teamId);
}

export async function insertBooking(user, input) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const resourceResult = await client.query(
      'SELECT id, capacity, is_active FROM resources WHERE id = $1 FOR SHARE',
      [input.resourceId]
    );
    const resource = resourceResult.rows[0];

    if (!resource || !resource.is_active) {
      throw new ApiError(404, 'Resource not available');
    }

    if (input.attendees > resource.capacity) {
      throw new ApiError(400, 'Attendees exceed capacity');
    }

    await validateTeamBooking(client, user, input.bookingType, input.teamId);

    if (input.idempotencyKey) {
      const existing = await client.query(
        `SELECT *
         FROM bookings
         WHERE created_by = $1
           AND idempotency_key = $2
         LIMIT 1`,
        [user.id, input.idempotencyKey]
      );

      if (existing.rows[0]) {
        await client.query('COMMIT');
        return existing.rows[0];
      }
    }

    let booking;

    try {
      const result = await client.query(
        `INSERT INTO bookings
          (resource_id, created_by, booking_type, team_id, start_time, end_time, attendees, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          resource.id,
          user.id,
          input.bookingType,
          input.teamId ?? null,
          input.startTime,
          input.endTime,
          input.attendees,
          input.idempotencyKey ?? null,
        ]
      );
      booking = result.rows[0];
    } catch (err) {
      if (err.code === '23505' && input.idempotencyKey) {
        const existing = await client.query(
          `SELECT *
           FROM bookings
           WHERE created_by = $1
             AND idempotency_key = $2
           LIMIT 1`,
          [user.id, input.idempotencyKey]
        );

        if (existing.rows[0]) {
          await client.query('COMMIT');
          return existing.rows[0];
        }
      }

      throw err;
    }

    await client.query('COMMIT');
    return booking;
  } catch (err) {
    await client.query('ROLLBACK');

    if (err.code === '23P01') {
      throw new ApiError(409, 'This slot is already booked');
    }

    if (err.code === '23505') {
      throw new ApiError(409, 'Duplicate booking request');
    }

    throw err;
  } finally {
    client.release();
  }
}
