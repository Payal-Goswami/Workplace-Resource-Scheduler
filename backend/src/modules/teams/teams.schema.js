import { z } from 'zod';

export const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const teamMemberSchema = z.object({
  userId: z.string().uuid(),
});

export const editAttendeesSchema = z.object({
  attendees: z.number().int().min(1),
});

export const changeLeadSchema = z.object({
  newLeadId: z.string().uuid(),
  previousLeadAction: z.enum(['KEEP', 'REMOVE']),
});
