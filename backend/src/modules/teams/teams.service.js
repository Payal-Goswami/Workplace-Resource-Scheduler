import { pool } from '../../../db/pool.js';
import { ApiError } from '../../utils/apiError.js';

async function requireTeamLeadOrAdmin(client, user, teamId) {
  const result = await client.query(
    'SELECT id, name, lead_user_id, deleted_at FROM teams WHERE id = $1',
    [teamId]
  );
  const team = result.rows[0];

  if (!team || team.deleted_at) {
    throw new ApiError(404, 'Team not found');
  }

  if (user.role !== 'FACILITY_ADMIN' && team.lead_user_id !== user.id) {
    throw new ApiError(403, 'Forbidden');
  }

  return team;
}

async function getFutureTeamBookings(teamId) {
  const result = await pool.query(
    `SELECT b.id,
            b.start_time,
            b.end_time,
            b.attendees,
            r.name AS room_name,
            r.capacity AS room_capacity
     FROM bookings b
     JOIN resources r ON r.id = b.resource_id
     WHERE b.team_id = $1
       AND b.booking_type = 'TEAM'
       AND b.status = 'CONFIRMED'
       AND b.start_time > now()
     ORDER BY b.start_time`,
    [teamId]
  );
  return result.rows;
}

export async function createTeam(user, name) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const teamResult = await client.query(
      `INSERT INTO teams (name, lead_user_id)
       VALUES ($1, $2)
       RETURNING *`,
      [name, user.id]
    );
    const team = teamResult.rows[0];

    await client.query(
      `INSERT INTO team_memberships (team_id, user_id)
       VALUES ($1, $2)`,
      [team.id, user.id]
    );

    await client.query('COMMIT');
    return team;
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      throw new ApiError(409, 'An active team with this name already exists');
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function searchUsers(query) {
  const result = await pool.query(
    `SELECT id, email, name, designation
     FROM users
     WHERE is_active = true
       AND (name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')
     ORDER BY name
     LIMIT 20`,
    [query]
  );
  return result.rows;
}

export async function addTeamMember(user, teamId, targetUserId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await requireTeamLeadOrAdmin(client, user, teamId);

    const targetResult = await client.query(
      'SELECT id FROM users WHERE id = $1 AND is_active = true',
      [targetUserId]
    );
    if (!targetResult.rows[0]) {
      throw new ApiError(404, 'User not found');
    }

    const existingResult = await client.query(
      `SELECT id, removed_at
       FROM team_memberships
       WHERE team_id = $1
         AND user_id = $2
       ORDER BY added_at DESC
       LIMIT 1`,
      [teamId, targetUserId]
    );

    if (existingResult.rows[0] && existingResult.rows[0].removed_at !== null) {
      await client.query(
        `UPDATE team_memberships
         SET removed_at = NULL, added_at = now()
         WHERE id = $1`,
        [existingResult.rows[0].id]
      );
    } else if (!existingResult.rows[0]) {
      await client.query(
        `INSERT INTO team_memberships (team_id, user_id)
         VALUES ($1, $2)`,
        [teamId, targetUserId]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const futureBookings = await getFutureTeamBookings(teamId);
  return futureBookings;
}

export async function removeTeamMember(user, teamId, targetUserId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const team = await requireTeamLeadOrAdmin(client, user, teamId);

    if (team.lead_user_id === targetUserId) {
      throw new ApiError(400, 'Team lead cannot be removed directly');
    }

    const membershipResult = await client.query(
      `UPDATE team_memberships
       SET removed_at = now()
       WHERE team_id = $1
         AND user_id = $2
         AND removed_at IS NULL
       RETURNING id`,
      [teamId, targetUserId]
    );

    if (!membershipResult.rows[0]) {
      throw new ApiError(404, 'Active team membership not found');
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const futureBookings = await getFutureTeamBookings(teamId);
  return futureBookings;
}

export async function editTeamBookingAttendees(user, bookingId, attendees) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const bookingResult = await client.query(
      `SELECT b.*, r.capacity
       FROM bookings b
       JOIN resources r ON r.id = b.resource_id
       WHERE b.id = $1
       FOR UPDATE OF b`,
      [bookingId]
    );
    const booking = bookingResult.rows[0];

    if (!booking || booking.booking_type !== 'TEAM') {
      throw new ApiError(404, 'Team booking not found');
    }

    if (booking.status !== 'CONFIRMED' || new Date(booking.start_time) <= new Date()) {
      throw new ApiError(400, 'Only future confirmed team bookings can be edited');
    }

    await requireTeamLeadOrAdmin(client, user, booking.team_id);

    if (attendees > booking.capacity) {
      throw new ApiError(400, 'Attendees exceed room capacity');
    }

    const updateResult = await client.query(
      'UPDATE bookings SET attendees = $1 WHERE id = $2 RETURNING *',
      [attendees, bookingId]
    );

    await client.query('COMMIT');
    return updateResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function changeTeamLead(user, teamId, newLeadId, previousLeadAction) {
  if (user.role !== 'FACILITY_ADMIN') {
    throw new ApiError(403, 'Forbidden');
  }

  if (!['KEEP', 'REMOVE'].includes(previousLeadAction)) {
    throw new ApiError(400, 'previousLeadAction must be KEEP or REMOVE');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const teamResult = await client.query(
      'SELECT * FROM teams WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [teamId]
    );
    const team = teamResult.rows[0];
    if (!team) {
      throw new ApiError(404, 'Team not found');
    }

    const membershipResult = await client.query(
      `SELECT id
       FROM team_memberships
       WHERE team_id = $1
         AND user_id = $2
         AND removed_at IS NULL`,
      [teamId, newLeadId]
    );
    if (!membershipResult.rows[0]) {
      throw new ApiError(400, 'New lead must be an active team member');
    }

    await client.query(
      'UPDATE teams SET lead_user_id = $1 WHERE id = $2',
      [newLeadId, teamId]
    );

    if (previousLeadAction === 'REMOVE' && team.lead_user_id !== newLeadId) {
      await client.query(
        `UPDATE team_memberships
         SET removed_at = now()
         WHERE team_id = $1
           AND user_id = $2
           AND removed_at IS NULL`,
        [teamId, team.lead_user_id]
      );
    }

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'TEAM_LEAD_CHANGED', 'team', $2, $3::jsonb)`,
      [
        user.id,
        teamId,
        JSON.stringify({ previousLeadId: team.lead_user_id, newLeadId, previousLeadAction }),
      ]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getTeamDeletePreview(user, teamId) {
  const client = await pool.connect();
  try {
    await requireTeamLeadOrAdmin(client, user, teamId);
  } finally {
    client.release();
  }

  return getFutureTeamBookings(teamId);
}

export async function deleteTeam(user, teamId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await requireTeamLeadOrAdmin(client, user, teamId);

    const teamResult = await client.query(
      'SELECT id FROM teams WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [teamId]
    );
    if (!teamResult.rows[0]) {
      throw new ApiError(404, 'Team not found');
    }

    await client.query(
      `UPDATE bookings
       SET status = 'CANCELLED',
           cancel_reason = 'TEAM_DELETED',
           cancelled_by = $2,
           cancelled_at = now()
       WHERE team_id = $1
         AND booking_type = 'TEAM'
         AND status = 'CONFIRMED'
         AND start_time > now()`,
      [teamId, user.id]
    );

    await client.query(
      'UPDATE teams SET deleted_at = now() WHERE id = $1',
      [teamId]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, details)
       VALUES ($1, 'TEAM_DELETED', 'team', $2, $3::jsonb)`,
      [user.id, teamId, JSON.stringify({ deletedTeamId: teamId })]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
