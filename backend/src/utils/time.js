export const IST_OFFSET = '+05:30';

export function istToUtc(dateStr, hhmm) {
  return new Date(`${dateStr}T${hhmm}:00${IST_OFFSET}`);
}
