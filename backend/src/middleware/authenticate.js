import { createClient } from '@supabase/supabase-js';
import { pool } from '../../db/pool.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.replace('Bearer ', '').trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = data.user;

  await pool.query(
    `INSERT INTO users (id, email, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [user.id, user.email, user.user_metadata?.name ?? user.email]
  );

  const { rows } = await pool.query(
    'SELECT id, email, name, designation, role, is_active FROM users WHERE id = $1',
    [user.id]
  );

  const dbUser = rows[0];

  if (!dbUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!dbUser.is_active) {
    return res.status(403).json({ error: 'Account inactive' });
  }

  req.user = dbUser;
  next();
}
