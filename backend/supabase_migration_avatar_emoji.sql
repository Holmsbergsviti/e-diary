-- Add avatar_emoji column to students, teachers, and admins tables
-- Allows storing emoji avatars as an alternative to profile pictures

ALTER TABLE ediary_schema.students
ADD COLUMN IF NOT EXISTS avatar_emoji text;

ALTER TABLE ediary_schema.teachers
ADD COLUMN IF NOT EXISTS avatar_emoji text;

ALTER TABLE ediary_schema.admins
ADD COLUMN IF NOT EXISTS avatar_emoji text;

-- Add comment to explain the column
COMMENT ON COLUMN ediary_schema.students.avatar_emoji IS 'Single emoji character used as avatar (e.g., 😊)';
COMMENT ON COLUMN ediary_schema.teachers.avatar_emoji IS 'Single emoji character used as avatar (e.g., 😊)';
COMMENT ON COLUMN ediary_schema.admins.avatar_emoji IS 'Single emoji character used as avatar (e.g., 😊)';
