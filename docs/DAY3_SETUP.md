# Day 3 Setup Notes

## Seed Resources

The application seed data is stored in `backend/db/seed/resources.json`.

Validate and generate the SQL migration from that file:

```bash
cd backend
npm run validate:seed
npm run generate:seed
npm run migrate
```

The migration `backend/db/migrations/0005_seed_resources.sql` inserts all resources
from the existing JSON seed file. It should not be edited manually.

## First Facility Admin

After a user has logged in for the first time, set that user as the facility admin
once in the Supabase SQL Editor:

```sql
UPDATE users
SET role = 'FACILITY_ADMIN'
WHERE email = 'your@email.com';
```

## Authentication Check

Start the backend:

```bash
cd backend
npm start
```

Without a bearer token:

```bash
curl http://localhost:4000/me
```

This should return HTTP 401.

With a Supabase access token:

```bash
curl -H "Authorization: Bearer <TOKEN>" http://localhost:4000/me
```

This should return the user's database record.
