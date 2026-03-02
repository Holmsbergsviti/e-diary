-- ============================================================
--  Chartwell E-Diary – Supabase Schema
--  Run this in your Supabase SQL Editor to set up all tables.
-- ============================================================

-- Classes (e.g. "12A", "11B")
CREATE TABLE IF NOT EXISTS classes (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    grade_level INT
);

-- Users (students, teachers, admins)
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL,
    email         TEXT,
    role          TEXT NOT NULL DEFAULT 'student'
                  CHECK (role IN ('student', 'teacher', 'admin')),
    class_id      INT REFERENCES classes(id),
    class_name    TEXT  -- denormalised convenience column
);

-- Subjects
CREATE TABLE IF NOT EXISTS subjects (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    class_id   INT REFERENCES classes(id),
    teacher_id INT REFERENCES users(id)
);

-- Weekly schedule (one row per lesson slot)
CREATE TABLE IF NOT EXISTS schedule (
    id           SERIAL PRIMARY KEY,
    class_id     INT NOT NULL REFERENCES classes(id),
    subject_id   INT NOT NULL REFERENCES subjects(id),
    teacher_id   INT          REFERENCES users(id),
    day_of_week  INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 5), -- 1=Mon … 5=Fri
    period       INT NOT NULL CHECK (period BETWEEN 1 AND 8),
    room         TEXT
);

-- Grades
CREATE TABLE IF NOT EXISTS grades (
    id          SERIAL PRIMARY KEY,
    student_id  INT  NOT NULL REFERENCES users(id),
    subject_id  INT  NOT NULL REFERENCES subjects(id),
    value       INT  NOT NULL CHECK (value BETWEEN 1 AND 5),
    date        DATE NOT NULL DEFAULT CURRENT_DATE,
    grade_type  TEXT DEFAULT 'oral'
                CHECK (grade_type IN ('oral', 'written', 'test', 'homework', 'project')),
    description TEXT
);

-- Announcements
CREATE TABLE IF NOT EXISTS announcements (
    id         SERIAL PRIMARY KEY,
    title      TEXT NOT NULL,
    body       TEXT,
    author_id  INT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
--  Row-Level Security – enable on all tables
-- ============================================================
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects      ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule      ENABLE ROW LEVEL SECURITY;
ALTER TABLE grades        ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- The Django backend connects with the service role key which
-- bypasses RLS, so no explicit policies are needed for the API.
-- Add policies here if you later expose tables directly to
-- the Supabase JS client in the browser.
