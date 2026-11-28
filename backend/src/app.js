import express from 'express';
import cors from 'cors';
import { authenticate } from './middleware/authenticate.js';
import { requireRole } from './middleware/requireRole.js';
import errorHandler from './middleware/errorHandler.js';
import { listResources, getResourceAvailability } from './modules/resources/resources.repo.js';
import { createBookingSchema } from './modules/bookings/bookings.schema.js';
import { insertBooking, validateBookingRules } from './modules/bookings/bookings.service.js';
import { cancelBooking, getDashboard } from './modules/bookings/bookings.service.js';
import { bookingAndCancelRateLimit } from './middleware/bookingRateLimit.js';
import {
  createTeamSchema,
  teamMemberSchema,
  editAttendeesSchema,
  changeLeadSchema,
} from './modules/teams/teams.schema.js';
import {
  createTeam,
  searchUsers,
  addTeamMember,
  removeTeamMember,
  editTeamBookingAttendees,
  changeTeamLead,
  getTeamDeletePreview,
  deleteTeam,
} from './modules/teams/teams.service.js';
import {
  createResourceSchema,
  updateResourceSchema,
  disableResourceSchema,
} from './modules/admin/admin.schema.js';
import {
  listAdminResources,
  createResource,
  getResourceDisableWarning,
  disableResource,
  enableResource,
  updateResource,
  listAdminTeams,
  listAdminBookings,
} from './modules/admin/admin.service.js';

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

app.post('/bookings', authenticate, bookingAndCancelRateLimit, async (req, res, next) => {
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

app.patch('/bookings/:id/cancel', authenticate, bookingAndCancelRateLimit, async (req, res, next) => {
  try {
    const booking = await cancelBooking(req.user, req.params.id);
    return res.json(booking);
  } catch (err) {
    next(err);
  }
});

app.get('/me/dashboard', authenticate, async (req, res, next) => {
  try {
    const dashboard = await getDashboard(req.user);
    return res.json(dashboard);
  } catch (err) {
    next(err);
  }
});

app.post('/teams', authenticate, async (req, res, next) => {
  try {
    const parsed = createTeamSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const team = await createTeam(req.user, parsed.data.name);
    return res.status(201).json(team);
  } catch (err) {
    next(err);
  }
});

app.get('/users/search', authenticate, async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim();
    if (!query) {
      return res.json([]);
    }

    return res.json(await searchUsers(query));
  } catch (err) {
    next(err);
  }
});

app.post('/teams/:id/members', authenticate, async (req, res, next) => {
  try {
    const parsed = teamMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const futureBookings = await addTeamMember(req.user, req.params.id, parsed.data.userId);
    return res.json({ futureBookings });
  } catch (err) {
    next(err);
  }
});

app.delete('/teams/:id/members/:userId', authenticate, async (req, res, next) => {
  try {
    const futureBookings = await removeTeamMember(req.user, req.params.id, req.params.userId);
    return res.json({ futureBookings });
  } catch (err) {
    next(err);
  }
});

app.patch('/bookings/:id/attendees', authenticate, async (req, res, next) => {
  try {
    const parsed = editAttendeesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const booking = await editTeamBookingAttendees(req.user, req.params.id, parsed.data.attendees);
    return res.json(booking);
  } catch (err) {
    next(err);
  }
});

app.patch('/teams/:id/lead', authenticate, async (req, res, next) => {
  try {
    const parsed = changeLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    await changeTeamLead(
      req.user,
      req.params.id,
      parsed.data.newLeadId,
      parsed.data.previousLeadAction
    );
    return res.json({ updated: true });
  } catch (err) {
    next(err);
  }
});

app.get('/teams/:id/delete-preview', authenticate, async (req, res, next) => {
  try {
    const bookings = await getTeamDeletePreview(req.user, req.params.id);
    return res.json({ futureBookings: bookings });
  } catch (err) {
    next(err);
  }
});

app.delete('/teams/:id', authenticate, async (req, res, next) => {
  try {
    await deleteTeam(req.user, req.params.id);
    return res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

const requireAdmin = [authenticate, requireRole('FACILITY_ADMIN')];

app.get('/admin/health', ...requireAdmin, (req, res) => {
  res.json({ ok: true, role: req.user.role });
});

app.get('/admin/resources', ...requireAdmin, async (req, res, next) => {
  try {
    return res.json(await listAdminResources());
  } catch (err) {
    next(err);
  }
});

app.post('/admin/resources', ...requireAdmin, async (req, res, next) => {
  try {
    const parsed = createResourceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const resource = await createResource(req.user.id, parsed.data);
    return res.status(201).json(resource);
  } catch (err) {
    next(err);
  }
});

app.get('/admin/resources/:id/disable-warning', ...requireAdmin, async (req, res, next) => {
  try {
    return res.json(await getResourceDisableWarning(req.params.id));
  } catch (err) {
    next(err);
  }
});

app.post('/admin/resources/:id/disable', ...requireAdmin, async (req, res, next) => {
  try {
    const parsed = disableResourceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    return res.json(
      await disableResource(req.user.id, req.params.id, parsed.data.expectedCount)
    );
  } catch (err) {
    next(err);
  }
});

app.post('/admin/resources/:id/enable', ...requireAdmin, async (req, res, next) => {
  try {
    return res.json(await enableResource(req.user.id, req.params.id));
  } catch (err) {
    next(err);
  }
});

app.patch('/admin/resources/:id', ...requireAdmin, async (req, res, next) => {
  try {
    const parsed = updateResourceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    return res.json(await updateResource(req.user.id, req.params.id, parsed.data));
  } catch (err) {
    next(err);
  }
});

app.get('/admin/teams', ...requireAdmin, async (req, res, next) => {
  try {
    return res.json(await listAdminTeams());
  } catch (err) {
    next(err);
  }
});

app.get('/admin/bookings', ...requireAdmin, async (req, res, next) => {
  try {
    return res.json(await listAdminBookings());
  } catch (err) {
    next(err);
  }
});

app.use(errorHandler);

export default app;
