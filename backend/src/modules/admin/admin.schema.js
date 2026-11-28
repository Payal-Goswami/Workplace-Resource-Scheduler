import { z } from 'zod';

const resourceTypes = [
  'MEETING_ROOM',
  'SEMINAR_HALL',
  'CONFERENCE_ROOM',
  'BOARDROOM',
  'HUDDLE_ROOM',
  'FOCUS_BOOTH',
];

export const createResourceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(resourceTypes),
  capacity: z.number().int().min(1),
  description: z.string().trim().max(1000).nullable().optional(),
  image_path: z.string().trim().max(2048).nullable().optional(),
  block: z.string().trim().min(1).max(20),
  floor: z.number().int(),
  room_number: z.string().trim().min(1).max(30),
});

export const updateResourceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  type: z.enum(resourceTypes).optional(),
  capacity: z.number().int().min(1).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  image_path: z.string().trim().max(2048).nullable().optional(),
  block: z.string().trim().min(1).max(20).optional(),
  floor: z.number().int().optional(),
  room_number: z.string().trim().min(1).max(30).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided',
});

export const disableResourceSchema = z.object({
  expectedCount: z.number().int().min(0),
});
