-- Convert timestamp columns to TIMESTAMPTZ so that UTC values are preserved

ALTER TABLE calls
  ALTER COLUMN external_created_at TYPE TIMESTAMPTZ
    USING external_created_at AT TIME ZONE 'UTC';

ALTER TABLE calls
  ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING created_at AT TIME ZONE 'UTC';

ALTER TABLE calls
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ
    USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE calls
  ALTER COLUMN synced_at TYPE TIMESTAMPTZ
    USING synced_at AT TIME ZONE 'UTC';

ALTER TABLE calls
  ALTER COLUMN processed_at TYPE TIMESTAMPTZ
    USING processed_at AT TIME ZONE 'UTC';

ALTER TABLE call_metadata
  ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING created_at AT TIME ZONE 'UTC';

ALTER TABLE users
  ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING created_at AT TIME ZONE 'UTC';

ALTER TABLE users
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ
    USING updated_at AT TIME ZONE 'UTC';

