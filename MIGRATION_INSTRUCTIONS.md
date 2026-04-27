# Database migrations

Schema additions used by the app. Run from the Supabase SQL editor.

## Avatar emoji

```sql
ALTER TABLE ediary_schema.students
ADD COLUMN IF NOT EXISTS avatar_emoji text;

ALTER TABLE ediary_schema.teachers
ADD COLUMN IF NOT EXISTS avatar_emoji text;

ALTER TABLE ediary_schema.admins
ADD COLUMN IF NOT EXISTS avatar_emoji text;
```

## Attendance per period + minutes late

```sql
ALTER TABLE ediary_schema.attendance
ADD COLUMN IF NOT EXISTS period int NULL,
ADD COLUMN IF NOT EXISTS minutes_late int NULL;
```
