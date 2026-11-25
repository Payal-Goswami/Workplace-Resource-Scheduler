import { z } from 'zod';

export const createBookingSchema = z.object({
  resourceId: z.string().uuid(),
  startTime: z.string().datetime({ offset: true }),
  endTime: z.string().datetime({ offset: true }),
  attendees: z.number().int().min(1),
  bookingType: z.enum(['PERSONAL', 'TEAM', 'GROUP_EVENT']),
  teamId: z.string().uuid().optional(),
});
