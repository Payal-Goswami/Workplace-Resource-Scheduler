import express from 'express';
import cors from 'cors';
import { authenticate } from './middleware/authenticate.js';
import { requireRole } from './middleware/requireRole.js';
import errorHandler from './middleware/errorHandler.js';

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

app.get('/admin/health', authenticate, requireRole('FACILITY_ADMIN'), (req, res) => {
  res.json({ ok: true, role: req.user.role });
});

app.use(errorHandler);

export default app;
