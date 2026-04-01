-- Supabase migration: teacher reports (Winter / End of Year)
-- Run in Supabase SQL Editor

CREATE SCHEMA IF NOT EXISTS ediary_schema;

CREATE TABLE IF NOT EXISTS ediary_schema.teacher_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES ediary_schema.teachers(id),
  student_id uuid NOT NULL REFERENCES ediary_schema.students(id),
  subject_id uuid NOT NULL REFERENCES ediary_schema.subjects(id),
  class_id uuid NOT NULL REFERENCES ediary_schema.classes(id),
  term smallint NOT NULL CHECK (term IN (1, 2)),
  report_grade text,
  effort text,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teacher_reports_unique UNIQUE (teacher_id, student_id, subject_id, class_id, term)
);

CREATE INDEX IF NOT EXISTS idx_teacher_reports_teacher_term
  ON ediary_schema.teacher_reports (teacher_id, term);

CREATE INDEX IF NOT EXISTS idx_teacher_reports_student
  ON ediary_schema.teacher_reports (student_id);
