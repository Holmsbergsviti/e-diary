# Avatar Emoji Migration Instructions

## What needs to be done:

The backend API has been updated to support `avatar_emoji` field for user avatars, but the database schema needs to be updated to store this data.

## Steps to complete:

### Option 1: Run migration via Supabase Dashboard (Recommended)

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your e-diary project
3. Go to **SQL Editor** (left sidebar)
4. Click **New Query**
5. Copy and paste the following SQL:

```sql
-- Add avatar_emoji column to students, teachers, and admins tables
ALTER TABLE ediary_schema.students
ADD COLUMN IF NOT EXISTS avatar_emoji text;

ALTER TABLE ediary_schema.teachers
ADD COLUMN IF NOT EXISTS avatar_emoji text;

ALTER TABLE ediary_schema.admins
ADD COLUMN IF NOT EXISTS avatar_emoji text;
```

6. Click **Run** button
7. Check for success message ✅

### Option 2: Run via Python script

```bash
cd c:\Users\Stepan\OneDrive\Документы\GitHub\e-diary
python3 run_migration.py
```

## What this migration does:

- ✅ Adds `avatar_emoji` column to `ediary_schema.students` table
- ✅ Adds `avatar_emoji` column to `ediary_schema.teachers` table  
- ✅ Adds `avatar_emoji` column to `ediary_schema.admins` table
- ✅ Column stores single emoji character (e.g., "😊")
- ✅ Defaults to NULL (no emoji selected)

## After Migration:

The emoji avatar feature will be fully functional:
- Users can select emoji as their avatar
- Backend will store and return the emoji
- Frontend will display emoji in profile and navigation

## Troubleshooting:

If the migration fails or schema already has the column:
- The SQL uses `IF NOT EXISTS` so it's safe to run multiple times
- Check Supabase dashboard for any error messages
- Ensure you have permissions to modify the table schema

---

**Status**: Backend API code ✅ deployed | Database schema ⏳ pending migration
