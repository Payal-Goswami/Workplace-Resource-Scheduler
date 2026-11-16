CREATE TABLE users (
  id          uuid PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  name        text NOT NULL,
  designation text,
  role        user_role NOT NULL DEFAULT 'EMPLOYEE',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teams (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  lead_user_id uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE TABLE team_memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id),
  added_at   timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);

CREATE TABLE resources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        resource_type NOT NULL,
  capacity    integer NOT NULL CHECK (capacity >= 1),
  description text,
  image_path  text,
  block       text NOT NULL,
  floor       integer NOT NULL,
  room_number text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id     uuid NOT NULL REFERENCES resources(id),
  created_by      uuid NOT NULL REFERENCES users(id),
  booking_type    booking_type NOT NULL DEFAULT 'PERSONAL',
  team_id         uuid REFERENCES teams(id),
  start_time      timestamptz NOT NULL,
  end_time        timestamptz NOT NULL,
  attendees       integer NOT NULL,
  status          booking_status NOT NULL DEFAULT 'CONFIRMED',
  cancel_reason   text,
  cancelled_by    uuid REFERENCES users(id),
  cancelled_at    timestamptz,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid REFERENCES users(id),
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  uuid,
  details    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
