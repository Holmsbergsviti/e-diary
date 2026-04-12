# Architecture

## Overview

Chartwell E-Diary is a full-stack school management system with a split deployment model:

- **Frontend:** static vanilla HTML/CSS/JS deployed on Netlify
- **Backend:** Django API deployed on Render
- **Data/Auth/Storage:** Supabase

```text
Frontend (Netlify, vanilla JS)
        ↓ HTTPS / JSON
Backend (Django API on Render)
        ↓ supabase-py
Supabase (Postgres + Auth + Storage)
```

## Why this architecture

- keeps the frontend simple and fast
- allows the API to stay stateless
- separates UI deployment from backend deployment
- uses Supabase for managed persistence, auth, and file storage

## Main roles

### Student
- dashboard with recent grades and homework completion
- grade view by subject
- weekly timetable with events, holidays, and attendance state
- behavioral entries view
- profile settings and avatar upload

### Teacher
- attendance recording
- marks and weighted assessment tracking
- homework creation and completion tracking
- behavioral entries
- study hall sessions
- substitute lesson handling
- term reports
- CSV / Excel exports

### Admin
- users, classes, subjects, schedules
- teacher assignments and student enrollments
- events and holidays
- CSV bulk import
- impersonation
- attendance conflict flags

## Security model

### Authentication
- Supabase Auth is used for sign-in
- Django issues a custom JWT after successful login
- JWTs expire after 8 hours
- login is rate-limited to 5 requests per minute per IP

### Authorization
- students are scoped to their own records
- teachers can only edit or delete resources they created where applicable
- admin permissions are re-checked from the database on requests for regular admins

### Upload validation
- avatar uploads only allow JPEG, PNG, and WebP
- max avatar size is 2 MB

## Data model summary

### Core tables
- `classes`
- `subjects`
- `grade_levels`

### User tables
- `students`
- `teachers`
- `admins`

### Relationship tables
- `teacher_assignments`
- `student_subjects`

### Academic data
- `grades`
- `attendance`
- `behavioral_entries`
- `homework`
- `homework_completions`
- `teacher_reports`
- `entries`

### Schedule and session data
- `schedule`
- `study_hall`
- `study_hall_attendance`
- `substitutes`

### Calendar data
- `events`
- `holidays`

The full SQL source is in [backend/supabase_schema.sql](../backend/supabase_schema.sql).

## Project structure

```text
e-diary/
├── frontend/
│   ├── scripts/
│   ├── styles/
│   └── *.html
├── backend/
│   ├── api/
│   │   ├── urls.py
│   │   ├── utils.py
│   │   ├── views.py
│   │   ├── views_auth.py
│   │   └── views_student.py
│   ├── backend/
│   └── supabase_schema.sql
└── docs/
```

## Known architectural debt

The biggest backend issue is still module size. The original [backend/api/views.py](../backend/api/views.py) remains too large and should continue being split into dedicated teacher and admin modules.
