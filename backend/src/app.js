import express from 'express';
import cors from 'cors';
import { authenticate } from './middleware/authenticate.js';
import { requireRole } from './middleware/requireRole.js';
import errorHandler from './middleware/errorHandler.js';
import { listResources, getResourceAvailability } from './modules/resources/resources.repo.js';
import { createBookingSchema } from './modules/bookings/bookings.schema.js';
import { insertBooking, validateBookingRules } from './modules/bookings/bookings.service.js';

const app = express();

app.use(express.json());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || true,
    credentials: true,
  })
);

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'workplace-resource-scheduler' });
});

app.get('/me', authenticate, (req, res) => {
  res.json(req.user);
});

app.get('/resources', async (req, res, next) => {
  try {
    const q = req.query.q || null;
    const type = req.query.type || null;
    const limit = req.query.limit || 12;
    const offset = req.query.offset || 0;

    const rows = await listResources({ q, type, limit, offset });
    return res.json({ items: rows, count: rows.length, limit: Number(limit), offset: Number(offset) });
  } catch (err) {
    next(err);
  }
});

app.get('/resources/:id/availability', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { date } = req.query;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const availability = await getResourceAvailability(id, date, req.user.id);
    return res.json(availability);
  } catch (err) {
    next(err);
  }
});

app.post('/bookings', authenticate, async (req, res, next) => {
  try {
    const parsed = createBookingSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request',
        details: parsed.error.flatten(),
      });
    }

    await validateBookingRules(req.user, parsed.data);

    const idempotencyKey = req.headers['idempotency-key'];
    const booking = await insertBooking(req.user, {
      ...parsed.data,
      idempotencyKey: idempotencyKey || null,
    });

    return res.status(201).json(booking);
  } catch (err) {
    next(err);
  }
});

app.get('/admin/health', authenticate, requireRole('FACILITY_ADMIN'), (req, res) => {
  res.json({ ok: true, role: req.user.role });
});

app.use(errorHandler);

export default app;
