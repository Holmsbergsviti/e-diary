-- ============================================================
--  E-Diary – Supabase Schema  (ediary_schema)
--  WARNING: This schema is for context only and is not meant
--  to be run.  Table order and constraints may not be valid
--  for execution.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS ediary_schema;

-- Classes (e.g. "12A", "11B")
CREATE TABLE ediary_schema.classes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  class_name text NOT NULL UNIQUE,
  grade_level smallint NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT classes_pkey PRIMARY KEY (id)
);

-- Subjects
CREATE TABLE ediary_schema.subjects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  color_code text,
  CONSTRAINT subjects_pkey PRIMARY KEY (id)
);

-- Grade-code lookup (A*, A, B, C, D, E, U)
CREATE TABLE ediary_schema.grade_levels (
  grade_code text NOT NULL,
  description text NOT NULL,
  numerical_weight smallint NOT NULL UNIQUE,
  CONSTRAINT grade_levels_pkey PRIMARY KEY (grade_code)
);

-- Admins (profile – FK to auth.users)
CREATE TABLE ediary_schema.admins (
  id uuid NOT NULL,
  name text NOT NULL,
  surname text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT admins_pkey PRIMARY KEY (id),
  CONSTRAINT admins_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);

-- Teachers (profile – FK to auth.users)
CREATE TABLE ediary_schema.teachers (
  id uuid NOT NULL,
  name text NOT NULL,
  surname text NOT NULL,
  is_class_teacher boolean DEFAULT false,
  class_teacher_of_class_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT teachers_pkey PRIMARY KEY (id),
  CONSTRAINT teachers_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id),
  CONSTRAINT teachers_class_teacher_of_class_id_fkey
    FOREIGN KEY (class_teacher_of_class_id) REFERENCES ediary_schema.classes(id)
);

-- Students (profile – FK to auth.users)
CREATE TABLE ediary_schema.students (
  id uuid NOT NULL UNIQUE,
  name text NOT NULL,
  surname text NOT NULL,
  class_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT students_pkey PRIMARY KEY (id),
  CONSTRAINT students_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id),
  CONSTRAINT students_class_id_fkey
    FOREIGN KEY (class_id) REFERENCES ediary_schema.classes(id)
);

-- Teacher → subject / class assignments
CREATE TABLE ediary_schema.teacher_assignments (
  teacher_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  class_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT teacher_assignments_pkey PRIMARY KEY (teacher_id, subject_id, class_id),
  CONSTRAINT teacher_assignments_teacher_id_fkey
    FOREIGN KEY (teacher_id) REFERENCES ediary_schema.teachers(id),
  CONSTRAINT teacher_assignments_subject_id_fkey
    FOREIGN KEY (subject_id) REFERENCES ediary_schema.subjects(id),
  CONSTRAINT teacher_assignments_class_id_fkey
    FOREIGN KEY (class_id) REFERENCES ediary_schema.classes(id)
);

-- Student ↔ subject enrolment
CREATE TABLE ediary_schema.student_subjects (
  student_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT student_subjects_pkey PRIMARY KEY (student_id, subject_id),
  CONSTRAINT student_subjects_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES ediary_schema.students(id),
  CONSTRAINT student_subjects_subject_id_fkey
    FOREIGN KEY (subject_id) REFERENCES ediary_schema.subjects(id)
);

-- Grades
-- category: exam, test, project, homework, classwork, other
-- term: 1 (Sep–Dec) or 2 (Jan–Jun)
CREATE TABLE ediary_schema.grades (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  assessment_name text NOT NULL,
  percentage numeric CHECK (percentage >= 0),
  grade_code text,
  date_taken date NOT NULL,
  comment text,
  category text DEFAULT 'other',
  term smallint DEFAULT 1,
  created_by_teacher_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT grades_pkey PRIMARY KEY (id),
  CONSTRAINT grades_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES ediary_schema.students(id),
  CONSTRAINT grades_subject_id_fkey
    FOREIGN KEY (subject_id) REFERENCES ediary_schema.subjects(id),
  CONSTRAINT grades_created_by_teacher_id_fkey
    FOREIGN KEY (created_by_teacher_id) REFERENCES ediary_schema.teachers(id)
);

-- Attendance
CREATE TABLE ediary_schema.attendance (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  class_id uuid NOT NULL,
  date_recorded date NOT NULL,
  status text NOT NULL
    CHECK (status = ANY (ARRAY['Present','Absent','Late','Excused'])),
  comment text,
  subject_id uuid REFERENCES ediary_schema.subjects(id),
  topic text DEFAULT '',
  recorded_by_teacher_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT attendance_pkey PRIMARY KEY (id),
  CONSTRAINT attendance_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES ediary_schema.students(id),
  CONSTRAINT attendance_class_id_fkey
    FOREIGN KEY (class_id) REFERENCES ediary_schema.classes(id),
  CONSTRAINT attendance_recorded_by_teacher_id_fkey
    FOREIGN KEY (recorded_by_teacher_id) REFERENCES ediary_schema.teachers(id)
);

-- Behavioural entries (remarks / incidents)
CREATE TABLE ediary_schema.behavioral_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  teacher_id uuid NOT NULL,
  student_id uuid NOT NULL,
  class_id uuid,
  subject_id uuid,
  entry_type text NOT NULL,
  content text NOT NULL,
  severity text,
  CONSTRAINT behavioral_entries_pkey PRIMARY KEY (id),
  CONSTRAINT behavioral_entries_teacher_id_fkey
    FOREIGN KEY (teacher_id) REFERENCES ediary_schema.teachers(id),
  CONSTRAINT behavioral_entries_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES ediary_schema.students(id),
  CONSTRAINT behavioral_entries_class_id_fkey
    FOREIGN KEY (class_id) REFERENCES ediary_schema.classes(id),
  CONSTRAINT behavioral_entries_subject_id_fkey
    FOREIGN KEY (subject_id) REFERENCES ediary_schema.subjects(id)
);

-- Personal diary entries
CREATE TABLE ediary_schema.entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  subject_id uuid,
  title text,
  content text,
  mood text,
  entry_date date DEFAULT CURRENT_DATE,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT entries_pkey PRIMARY KEY (id)
);

-- Schedule (timetable slots)
CREATE TABLE ediary_schema.schedule (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  class_id uuid NOT NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 5),
  period smallint NOT NULL CHECK (period BETWEEN 1 AND 8),
  room text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT schedule_pkey PRIMARY KEY (id),
  CONSTRAINT schedule_unique_slot UNIQUE (teacher_id, day_of_week, period),
  CONSTRAINT schedule_teacher_id_fkey
    FOREIGN KEY (teacher_id) REFERENCES ediary_schema.teachers(id),
  CONSTRAINT schedule_subject_id_fkey
    FOREIGN KEY (subject_id) REFERENCES ediary_schema.subjects(id),
  CONSTRAINT schedule_class_id_fkey
    FOREIGN KEY (class_id) REFERENCES ediary_schema.classes(id)
);

-- Homework / tasks assigned by teachers
CREATE TABLE ediary_schema.homework (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  class_id uuid NOT NULL,
  title text NOT NULL,
  description text DEFAULT '',
  due_date date NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT homework_pkey PRIMARY KEY (id),
  CONSTRAINT homework_teacher_id_fkey
    FOREIGN KEY (teacher_id) REFERENCES auth.users(id),
  CONSTRAINT homework_subject_id_fkey
    FOREIGN KEY (subject_id) REFERENCES ediary_schema.subjects(id),
  CONSTRAINT homework_class_id_fkey
    FOREIGN KEY (class_id) REFERENCES ediary_schema.classes(id)
);

-- Semester reports by teacher (Winter / End of Year)
CREATE TABLE ediary_schema.teacher_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL,
  student_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  class_id uuid NOT NULL,
  term smallint NOT NULL CHECK (term IN (1, 2)),
  report_grade text,
  effort text,
  comment text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT teacher_reports_pkey PRIMARY KEY (id),
  CONSTRAINT teacher_reports_unique UNIQUE (teacher_id, student_id, subject_id, class_id, term),
  CONSTRAINT teacher_reports_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES ediary_schema.teachers(id),
  CONSTRAINT teacher_reports_student_id_fkey FOREIGN KEY (student_id) REFERENCES ediary_schema.students(id),
  CONSTRAINT teacher_reports_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES ediary_schema.subjects(id),
  CONSTRAINT teacher_reports_class_id_fkey FOREIGN KEY (class_id) REFERENCES ediary_schema.classes(id)
);

-- Events (special school events targeting groups or individual students)
CREATE TABLE ediary_schema.events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text DEFAULT '',
  event_date date NOT NULL,
  event_end_date date,
  start_time text,
  end_time text,
  affected_periods jsonb DEFAULT '[]'::jsonb,
  target_type text NOT NULL DEFAULT 'all' CHECK (target_type IN ('all', 'class', 'students')),
  target_class_ids jsonb DEFAULT '[]'::jsonb,
  target_student_ids jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT events_pkey PRIMARY KEY (id)
);

-- Holidays (school-wide non-school days)
CREATE TABLE ediary_schema.holidays (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT holidays_pkey PRIMARY KEY (id)
);

-- Study hall sessions (duty teacher creates for free periods)
CREATE TABLE ediary_schema.study_hall (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL,
  date date NOT NULL,
  period smallint NOT NULL CHECK (period BETWEEN 1 AND 8),
  room text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT study_hall_pkey PRIMARY KEY (id),
  CONSTRAINT study_hall_unique UNIQUE (teacher_id, date, period),
  CONSTRAINT study_hall_teacher_fkey FOREIGN KEY (teacher_id) REFERENCES ediary_schema.teachers(id)
);

-- Study hall attendance
CREATE TABLE ediary_schema.study_hall_attendance (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  study_hall_id uuid NOT NULL,
  student_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'Present' CHECK (status IN ('Present', 'Absent')),
  CONSTRAINT study_hall_attendance_pkey PRIMARY KEY (id),
  CONSTRAINT study_hall_attendance_unique UNIQUE (study_hall_id, student_id),
  CONSTRAINT study_hall_att_session_fkey FOREIGN KEY (study_hall_id) REFERENCES ediary_schema.study_hall(id) ON DELETE CASCADE,
  CONSTRAINT study_hall_att_student_fkey FOREIGN KEY (student_id) REFERENCES ediary_schema.students(id)
);
