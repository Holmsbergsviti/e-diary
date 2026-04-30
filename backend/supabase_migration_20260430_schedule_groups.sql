-- Generator v2: groups + nullable class_id on schedule.
-- Run from Supabase SQL editor.

ALTER TABLE ediary_schema.schedule
  ALTER COLUMN class_id DROP NOT NULL;

ALTER TABLE ediary_schema.schedule
  ADD COLUMN IF NOT EXISTS group_label text;

ALTER TABLE ediary_schema.schedule
  ADD COLUMN IF NOT EXISTS year_group smallint;

CREATE INDEX IF NOT EXISTS schedule_group_idx
  ON ediary_schema.schedule(subject_id, group_label);
CREATE INDEX IF NOT EXISTS schedule_year_idx
  ON ediary_schema.schedule(year_group);
