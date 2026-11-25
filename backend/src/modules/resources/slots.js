export const SLOT_START_HOUR = 9;
export const SLOT_END_HOUR = 18;
export const SLOT_MINUTES = 30;

export function generateDaySlots(dateStr) {
  const slots = [];

  const start = new Date(`${dateStr}T${String(SLOT_START_HOUR).padStart(2, '0')}:00:00+05:30`);
  const end = new Date(`${dateStr}T${String(SLOT_END_HOUR).padStart(2, '0')}:00:00+05:30`);

  for (let current = new Date(start); current < end; current = new Date(current.getTime() + SLOT_MINUTES * 60 * 1000)) {
    const slotStart = new Date(current);
    const slotEnd = new Date(slotStart.getTime() + SLOT_MINUTES * 60 * 1000);

    slots.push({
      start: slotStart.toISOString(),
      end: slotEnd.toISOString(),
      label: `${slotStart.toISOString().slice(11, 16)} - ${slotEnd.toISOString().slice(11, 16)}`,
    });
  }

  return slots;
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}
