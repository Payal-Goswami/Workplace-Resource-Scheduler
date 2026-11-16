CREATE INDEX idx_bookings_creator_start ON bookings (created_by, start_time);
CREATE INDEX idx_bookings_team_start ON bookings (team_id, start_time);
CREATE INDEX idx_memberships_user ON team_memberships (user_id);
CREATE INDEX idx_resources_active ON resources (is_active);

CREATE UNIQUE INDEX uq_booking_idempotency
  ON bookings (created_by, idempotency_key) WHERE idempotency_key IS NOT NULL;
