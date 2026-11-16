ALTER TABLE bookings ADD CONSTRAINT no_overlap EXCLUDE USING gist (
  resource_id WITH =,
  tstzrange(start_time, end_time, '[)') WITH &&
) WHERE (status = 'CONFIRMED');

ALTER TABLE bookings ADD CONSTRAINT valid_range CHECK (start_time < end_time);
ALTER TABLE bookings ADD CONSTRAINT attendees_positive CHECK (attendees >= 1);

ALTER TABLE bookings ADD CONSTRAINT slot_boundary CHECK (
  extract(second from (start_time AT TIME ZONE 'UTC')) = 0
  AND extract(second from (end_time AT TIME ZONE 'UTC')) = 0
  AND extract(minute from (start_time AT TIME ZONE 'UTC')) IN (0, 30)
  AND extract(minute from (end_time AT TIME ZONE 'UTC')) IN (0, 30)
);

ALTER TABLE bookings ADD CONSTRAINT team_type_consistency CHECK (
  (booking_type = 'TEAM' AND team_id IS NOT NULL) OR
  (booking_type <> 'TEAM' AND team_id IS NULL)
);

CREATE UNIQUE INDEX uq_active_membership
  ON team_memberships (team_id, user_id) WHERE removed_at IS NULL;

CREATE UNIQUE INDEX uq_team_name_active
  ON teams (lower(name)) WHERE deleted_at IS NULL;

ALTER TABLE resources ADD CONSTRAINT uq_resource_location UNIQUE (block, floor, room_number);
