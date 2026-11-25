import { pool } from '../../../db/pool.js';
import { istToUtc } from '../../utils/time.js';
import { generateDaySlots, overlaps } from './slots.js';

export async function listResources({ q, type, limit = 12, offset = 0 }) {
  const safeLimit = Math.min(Number(limit) || 12, 50);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const normalizedType = type ? type.toUpperCase() : null;

  const { rows } = await pool.query(
    `
      SELECT id, name, type, capacity, description, image_path, block, floor, room_number
      FROM resources
      WHERE is_active = true
        AND ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR description ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR type::text = $2)
      ORDER BY name
      LIMIT $3 OFFSET $4
    `,
    [q || null, normalizedType, safeLimit, safeOffset]
  );

  return rows;
}

export async function getResourceById(resourceId) {
  const { rows } = await pool.query(
    'SELECT id, name, type, capacity, description, image_path, block, floor, room_number, is_active FROM resources WHERE id = $1',
    [resourceId]
  );

  return rows[0] || null;
}

export async function getResourceAvailability(resourceId, dateStr, currentUserId) {
  const resource = await getResourceById(resourceId);

  if (!resource) {
    return { available: false, date: dateStr, slots: [] };
  }

  if (!resource.is_active) {
    return { available: false, date: dateStr, slots: [], resourceId: resource.id, name: resource.name };
  }

  const startOfDayUtc = istToUtc(dateStr, '00:00');
  const endOfDayUtc = new Date(startOfDayUtc.getTime() + 24 * 60 * 60 * 1000);

  const { rows: bookings } = await pool.query(
    `
      SELECT id, created_by, team_id, start_time, end_time, status, booking_type
      FROM bookings
      WHERE resource_id = $1
        AND status = 'CONFIRMED'
        AND start_time < $2
        AND end_time > $3
    `,
    [resourceId, endOfDayUtc.toISOString(), startOfDayUtc.toISOString()]
  );

  const now = new Date();
  const slots = generateDaySlots(dateStr).map((slot) => {
    const slotStartUtc = new Date(slot.start);
    const slotEndUtc = new Date(slot.end);

    const booking = bookings.find((entry) => overlaps(entry.start_time, entry.end_time, slot.start, slot.end));

    let status = 'FREE';
    if (slotEndUtc <= now) {
      status = 'PAST';
    } else if (booking) {
      status = booking.created_by === currentUserId ? 'OWN' : 'BOOKED';
    }

    return {
      start: slot.start,
      end: slot.end,
      label: slot.label,
      status,
    };
  });

  return {
    available: true,
    date: dateStr,
    resourceId: resource.id,
    slots,
  };
}
