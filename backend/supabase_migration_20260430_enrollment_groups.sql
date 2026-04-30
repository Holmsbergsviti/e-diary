-- Enrollment + group support for the new generator.
-- Adds english_level on students, group_label on student_subjects,
-- and a teacher_subjects table that pairs each teacher with the
-- subjects they are qualified to teach (with year restrictions).
--
-- Run from Supabase SQL editor.

-- 1. English level on students (1..5; null = unknown).
ALTER TABLE ediary_schema.students
  ADD COLUMN IF NOT EXISTS english_level smallint
  CHECK (english_level IS NULL OR english_level BETWEEN 1 AND 5);

-- 2. Group label on student_subjects (e.g. "Hist-1", "Eng-L3", "Math 12-2").
--    NULL = whole-class (no split needed, e.g. mandatory year 10/11 subjects).
ALTER TABLE ediary_schema.student_subjects
  ADD COLUMN IF NOT EXISTS group_label text;

-- 3. teacher_subjects: which subjects each teacher can teach + which
--    years they are allowed to teach. Replaces the per-class binding
--    of teacher_assignments for the new generator. teacher_assignments
--    stays for backwards compatibility with existing flows; it will
--    be dropped after the new generator is fully adopted.
CREATE TABLE IF NOT EXISTS ediary_schema.teacher_subjects (
  teacher_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  years_allowed text[] NOT NULL DEFAULT ARRAY['10','11','12','13'],
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT teacher_subjects_pkey PRIMARY KEY (teacher_id, subject_id),
  CONSTRAINT teacher_subjects_teacher_id_fkey
    FOREIGN KEY (teacher_id) REFERENCES ediary_schema.teachers(id) ON DELETE CASCADE,
  CONSTRAINT teacher_subjects_subject_id_fkey
    FOREIGN KEY (subject_id) REFERENCES ediary_schema.subjects(id) ON DELETE CASCADE
);

-- Indexes for the lookup paths the generator needs.
CREATE INDEX IF NOT EXISTS teacher_subjects_subject_idx
  ON ediary_schema.teacher_subjects(subject_id);
CREATE INDEX IF NOT EXISTS student_subjects_subject_idx
  ON ediary_schema.student_subjects(subject_id);
CREATE INDEX IF NOT EXISTS student_subjects_group_idx
  ON ediary_schema.student_subjects(subject_id, group_label);
