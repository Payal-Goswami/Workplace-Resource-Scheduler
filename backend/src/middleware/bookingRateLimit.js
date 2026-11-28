import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

export const bookingAndCancelRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: { error: 'Too many booking requests. Please try again later.' },
});
