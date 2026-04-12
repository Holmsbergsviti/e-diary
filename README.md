<p align="center">
  <img src="frontend/images/icon.png" alt="E-Diary Logo" width="80">
</p>

<h1 align="center">Chartwell E-Diary</h1>
<p align="center"><strong>A modern, full-stack school management platform</strong></p>
<p align="center">
  Built with Django · Supabase · Vanilla JS<br>
  <a href="https://chartwell-e-diary.netlify.app/">Live Demo</a>
</p>

---

## Table of Contents

- [Overview](#overview)
- [Account Types](#account-types)
  - [Student Account](#-student-account)
  - [Teacher Account](#-teacher-account)
  - [Admin Account](#-admin-account)
- [Full Feature List](#full-feature-list)
- [Security & Data Protection](#security--data-protection)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [Theme System](#theme-system)
- [Project Structure](#project-structure)
- [Setup & Deployment](#setup--deployment)
- [License](#license)

---

## Overview

**Chartwell E-Diary** is a comprehensive web-based school management system designed to streamline every aspect of the daily academic workflow. It connects students, teachers, and administrators in a single platform that covers grade tracking, attendance monitoring, homework management, behavioral logging, timetable scheduling, substitute lesson handling, study hall sessions, term reports, event management, and more.

The platform is built with simplicity and performance in mind — no heavyweight JavaScript frameworks, no complex build pipelines. Just clean, well-structured vanilla code that loads fast and works everywhere.

### How It Works

1. **Admins** set up the school: create classes, subjects, teachers, students, and build the master timetable.
2. **Teachers** use their dashboard daily to take attendance, assign grades, track homework, log behavioral notes, write term reports, and manage substitutions.
3. **Students** log in to check their grades, view their schedule, see homework assignments, and track their academic progress in real time.

Every action creates an audit trail. Every piece of data is scoped and isolated so users only see what they're authorized to see.

---

## Account Types

### 📘 Student Account

Students have a read-focused experience centered around viewing their own academic data.

#### Pages & Features

| Page | What Students Can Do |
|---|---|
| **Dashboard** | See upcoming homework with completion badges (✅ Completed, ⚠️ Partial, ❌ Not Done), a circular progress chart showing overall homework completion %, and a table of recent grades from the last 7 days with color-coded grade badges. View behavioral notes (positive 👍, negative 👎, note 📝) with severity color-coding. |
| **Grades** | View all grades organized by subject as separate cards. Each card displays a table of assessments with grade letter badge, percentage, date, and teacher comment. Includes a clickable teacher badge with a popover showing the teacher's avatar, name, email (clickable to copy), and subjects they teach. Filter by Term 1 (Sep–Dec), Term 2 (Jan–Jun), or both. |
| **Schedule** | Interactive weekly timetable grid (Mon–Fri, 8 periods from 08:30 to 15:30) with snack break (10:00–10:10) and lunch break (12:30–13:10). Week-by-week navigation with "current week" quick jump. Color-coded attendance indicators on each slot (green = present, yellow = late, red = absent, blue = excused). Holidays gray out entire columns. Events show as special overlays on affected dates. Study hall sessions appear as specially styled slots. Substitute lessons appear with amber highlighting and "SUB" badge. |
| **Profile** | View personal info (name, surname, email, role, class). Upload a profile picture (JPEG/PNG/WebP, max 2 MB). Change email and password (minimum 8 characters with confirmation). Select from 10 color themes with live preview. |

#### Data Access & Restrictions

- Students can **only** see their own data — grades, attendance, behavioral entries, and homework are all filtered server-side by student ID.
- Students **cannot** access any teacher or admin functionality.
- Students are automatically redirected if they try to access unauthorized pages.
- Diary entries are private and per-student.

#### Grade System

Grades use a letter system with weighted numerical values for average calculation:

| Grade | Value | Grade | Value | Grade | Value |
|-------|-------|-------|-------|-------|-------|
| A* | 9 | B+ | 6.5 | C- | 4 |
| A | 8 | B | 6 | D+ | 3.5 |
| A- | 7.5 | B- | 5.5 | D | 3 |
|  |  | C+ | 5 | D- | 2.5 |
|  |  | C | 4.5 | E+–E- | 2–1.5 |
|  |  |  |  | U | 1 |

#### Assessment Categories & Weights

| Category | Weight |
|----------|--------|
| Exam | 25% |
| Test | 20% |
| Project | 15% |
| Minitest | 15% |
| Quiz | 10% |
| Homework | 5% |
| Classwork | 5% |
| Other | 5% |

---

### 📗 Teacher Account

Teachers have the most feature-rich experience with tools for every aspect of classroom management.

#### Pages & Features

| Page / Tab | What Teachers Can Do |
|---|---|
| **Schedule (Dashboard Tab)** | View their personal weekly timetable with full week navigation. Click any class slot to open the attendance modal. See substitute lessons (amber cells with "Covering" badge for slots they're covering, or "Absent" badge with substitute name for their own slots being covered). Study hall sessions displayed. |
| **Attendance Modal** | Student roster for the selected class+subject+date. Each student has a status dropdown (Present, Late, Absent, Excused) and an optional comment field. A topic field at the top for the day's lesson topic. Students who are on an event/trip for that period are pre-marked with an event indicator. Saves all attendance records in one click. |
| **Marks / Grades** | Multi-tab view: **Class Overview** (if they're a class teacher — see all students in their homeroom class with every subject, per-student expandable stats) + **Subject Groups** (students grouped by assigned class for each subject they teach). Add, edit, and delete grades via a modal with: student, assessment name, category, term, grade code, percentage, and comment fields. Grade deletion uses a styled confirmation dialog. |
| **Per-Student Stats (Marks Page)** | Expandable card per student showing: attendance summary (total + per-term + trend), grade count + average, homework completion breakdown (completed/partial/not done with list), behavioral note counts (positive/negative/note), comments total (from attendance, grades, and behavioral), absent-today flag, and attendance conflict alerts. |
| **Homework Tab** | Add homework for any assigned class+subject with title, description, and due date. Delete homework. Track homework completions: open a homework item to set per-student completion status (Completed, Partial, Not Done). |
| **Behavioral Tab** | Add behavioral entries for any student in assigned classes. Choose type (positive, negative, or note), severity (low, medium, high), and write details. Delete entries. View all entries across all classes. |
| **Study Hall Tab** | Create study hall sessions for dates when they have free periods. System auto-detects students without scheduled classes at that time slot. Record study hall attendance (Present/Absent). Sessions appear in the schedule for both teacher and enrolled students. Blocked on holiday dates with a warning. |
| **Substitutes Tab** | Browse available classes to substitute: select date + period → system shows all classes at that slot (excluding own classes and already-covered ones). Create a substitute record linking to the original teacher's schedule slot. Add topic, room, and notes. Take attendance for the substitute lesson. View owned substitutes with edit/delete. **Original (absent) teacher** can click the substitute cell in their schedule to view attendance, topic, and notes in a read-only modal. |
| **Statistics Tab** | Aggregate class-level statistics across all taught classes: attendance rates, grade distributions, homework completion, behavioral summary. |
| **Exports Tab** | Export marks, attendance, homework, and statistics data as CSV or Excel (XLSX) files. Uses SheetJS for proper multi-sheet Excel workbooks with auto-column-width. |
| **Reports Page** | Write semester reports per student per subject. Choose term (Winter = Term 1, End of Year = Term 2). Set a report grade, effort level, and free-text comment for each student. Reports auto-save and support both create and update operations. Organized by class with collapsible subject sections. |
| **Comments Timeline** | View a chronological timeline of all comments for any student they teach, aggregated from three sources: attendance comments, grade comments, and behavioral entry details. |
| **Profile** | Same as student: avatar upload, email/password change, and theme picker. |

#### Data Access & Restrictions

- Teachers can only **edit/delete their own** grades (enforced by `created_by_teacher_id`).
- Teachers can only **delete their own** homework and behavioral entries.
- Teachers can only **delete their own** substitute records.
- Teachers can take attendance for any class they're assigned to teach.
- Teachers **cannot** access any admin functionality.

#### Auto-Generated Emails

Teacher emails follow the pattern: `firstname.surname@chartwell.edu.rs` (dot separator).

---

### 📕 Admin Account

Admins manage the entire school structure. The admin system has a 2-tier hierarchy with granular permissions.

#### Admin Levels

| Level | Description | Can Manage |
|---|---|---|
| **Master** | School lead admin. Has full access to all administrative features. Can create, edit, and delete regular admins. | Everything: all data, all settings, all regular admins. |
| **Regular** | Standard administrator with granular permissions. Only sees admin tabs matching their assigned permissions. | Only features matching their permission keys. |

#### Permission Keys (Regular Admins)

Regular admins are assigned a combination of these 11 permission keys. Permissions are stored as a JSONB object in the database and **re-verified from the database on every request** (not trusted from the JWT alone).

| Permission Key | What It Unlocks |
|---|---|
| `students` | View, create, edit, and delete students. Manage student-subject enrollments. Student lookup feature. |
| `teachers` | View, create, edit, and delete teachers. |
| `classes` | View, create, edit, and delete classes. |
| `subjects` | View, create, edit, and delete subjects. |
| `schedule` | View, create, edit, and delete schedule slots. Manage teacher–subject–class assignments. |
| `events` | View, create, edit, and delete events (with targeting: all-school, per-class, or per-student). |
| `holidays` | View, create, edit, and delete holidays (date ranges). |
| `import` | Access the CSV bulk import feature (supports 8 data types). |
| `impersonate` | Log in as any user to view their experience. Generates a temporary token. |
| `attendance` | View the attendance flags panel (detects suspicious conflicts: student absent in one class but present in another same day). |
| `exports` | Access data export functionality. |

#### Admin Pages & Features

| Section | What Admins Can Do |
|---|---|
| **Overview** | System-wide statistics: total classes, subjects, teachers, students, admins, assignments, enrollments, and schedule slots. Class breakdown table showing student counts per class. |
| **Classes** | CRUD for school classes (name + grade level). Styled confirmation on delete with warning about cascade effects. |
| **Subjects** | CRUD for subjects (name + optional color code for UI badges). |
| **Teachers** | Add teachers with name/surname and optional email/password (auto-generated if omitted: 10-character ambiguity-reduced password, `firstname.surname@chartwell.edu.rs` email). Edit teacher details. Delete with confirmation. View teacher list with avatars. Set class teacher status. |
| **Students** | Add students with name/surname and optional email/password (auto-generated if omitted). Assign to a class. Edit student details. Delete with confirmation. View student list grouped by class with avatars. |
| **Admins** | Add regular admins with fine-grained permission assignment. Master admins can create and manage regular admins. Edit admin permissions and level. Delete with level-appropriate authorization. |
| **Teacher Assignments** | Link teachers to subject+class combinations. This determines which classes a teacher can take attendance for and grade. |
| **Student Enrollments** | Enroll students in subjects, optionally with a group class override (for when a student in class 12A takes a subject with class 12B). |
| **Schedule** | Build the master timetable: assign teacher+subject+class to day-of-week + period + room. Unique constraint on (teacher, day, period) to prevent double-booking. |
| **Events** | Create school events with: title, description, date range, time range, affected periods, and targeting (all-school, specific classes, specific students, specific teachers). Events integrate into the schedule view and attendance system. |
| **Holidays** | Create holidays with name and date range. Holidays gray out schedule columns and block study hall creation on those dates. |
| **Attendance Flags** | Suspicious attendance conflict detector. Configurable date range. Shows students marked absent in one subject but present/late in another on the same date — useful for identifying truancy. |
| **CSV Bulk Import** | Import data from CSV files for all 8 entity types: classes, subjects, students, teachers, admins, teacher assignments, student enrollments, and schedule slots. Supports name-to-ID resolution (e.g., write "John Smith" in CSV instead of UUIDs). For students and teachers, auto-generates credentials and returns them as downloadable data. |
| **Student Lookup** | Deep-dive into a single student's complete academic record: all grades by subject, attendance summary, homework status, and behavioral entries. |
| **Impersonation** | Generate a temporary login session as any user to see exactly what they see. An impersonation banner is shown in the UI with a "Back to Admin" button. The admin's original session is preserved in localStorage for seamless return. |
| **Exports** | Export school data in various formats. |

#### Hierarchy Protection

- **Master admin** is hidden from regular admin user lists.
- A regular admin **cannot** edit or delete another admin of equal or higher level.
- Permission checks are **database-verified** on every request — changing permissions in the database takes immediate effect without requiring re-login.

---

## Full Feature List

### Authentication & Session Management
- Email/password login with rate limiting (5 attempts per minute per IP)
- JWT token-based sessions with 8-hour expiry
- Automatic logout on token expiration
- Role-based redirect after login (student → dashboard, teacher → teacher page, admin → admin panel)
- Client-side token validation on every page load
- Impersonation system with session preservation

### Timetable & Schedule
- Master schedule built by admins (teacher + subject + class → day + period + room)
- Weekly grid view with 8 periods and 5 days
- Period times: 08:30, 09:20, 10:10, 11:00, 11:50, 13:10, 14:00, 14:50
- Break rows: Snack Break (10:00–10:10) and Lunch Break (12:30–13:10)
- Week-by-week navigation with current-week highlighting
- Holiday detection and column gray-out
- Event overlay on affected dates
- Study hall session display
- Substitute lesson display (amber styling with badge indicators)
- Attendance status indicators per slot (student view)
- Current period highlighting during school hours
- Group class support (students enrolled in subjects from other classes see those in their schedule)

### Grading System
- Letter grades from A* to U with numerical weights for averaging
- 8 assessment categories with configurable weights
- Term-based (Term 1: Sep–Dec, Term 2: Jan–Jun) with auto-detection
- Teacher-scoped grade ownership (only the creator can edit/delete)
- Per-student weighted average calculation
- Grade-to-prediction mapping based on weighted scores
- Inline add, edit, and delete from the marks view
- Color-coded badge system for visual clarity

### Attendance System
- Per-class, per-subject, per-date attendance with 4 statuses: Present, Late, Absent, Excused
- Optional per-student comments
- Day's topic field
- Event-aware: students on events/trips flagged automatically
- Teacher records `recorded_by_teacher_id` for audit trail
- Attendance conflict detection (admin feature)
- Substitute teacher can take attendance for covered classes
- Study hall attendance tracking

### Homework & Announcements
- Teachers create homework with title, description, and due date
- Students see homework as announcements, filtered to their enrolled subjects
- 3-tier completion tracking: Completed, Partial, Not Done
- Teachers record completions per student
- Dashboard shows completion badges and circular progress chart
- Group class support (students see homework from their group-enrolled subjects)

### Behavioral Notes
- 3 entry types: Positive, Negative, Note
- 3 severity levels: Low, Medium, High
- Teacher creates entries for students in their assigned classes
- Students see their own entries on the dashboard
- Integrated into per-student stats and comments timeline
- Color-coded display (green for positive, red for negative, gray for note)

### Study Hall
- Teachers create sessions for free periods
- Smart student finder: system identifies students without classes at a given date+period
- Considers both home class and group class enrollment
- Attendance tracking (Present/Absent)
- Sessions appear in the schedule for teacher and participating students
- Blocked on holidays with a warning

### Substitute Lessons
- Substitute teacher browses available classes (date + period)
- System shows classes being taught at that time, excluding the substitute's own classes
- Already-covered classes filtered out to prevent double-substitution
- Creates a record linking original teacher → substitute teacher → class → subject
- Substitute can take attendance and write lesson topic
- Both teachers see the lesson in their schedule:
  - **Original teacher**: red "Absent" badge → click opens read-only detail view with attendance, topic, notes
  - **Substitute teacher**: green "Covering" badge → click opens full detail view
  - **Students**: amber "SUB" badge with substitute teacher name
- Delete/edit functionality for the substitute teacher

### Term Reports
- Two terms: Winter (Term 1) and End of Year (Term 2)
- Per-student, per-subject reports with: report grade, effort level, and free-text comment
- Organized by class with collapsible subject sections
- Upsert behavior (creates or updates existing reports)
- Teacher writes reports only for subjects they teach

### Events & Holidays
- **Events**: Title, description, date range, time range, affected periods, and multi-level targeting (all-school, per-class, per-student, per-teacher). Events integrate into the schedule and attendance system.
- **Holidays**: Name + date range. Visible to all users. Gray out schedule columns. Block study hall creation.

### CSV Bulk Import
- 8 supported import types: classes, subjects, students, teachers, admins, teacher assignments, student enrollments, schedule
- Smart name-to-ID resolution for relational imports (e.g., "John Smith" → UUID lookup)
- Auto-generation of emails and passwords for students and teachers
- Returns generated credentials for download
- Duplicate handling for emails (appends incrementing number)

### Profile & Personalization
- Avatar upload to Supabase Storage (JPEG/PNG/WebP, max 2 MB)
- Old avatars cleaned up automatically on replacement
- Email and password change with validation
- 10 color themes: Bright Blue (default), Ocean, Purple, Emerald, Rose, Amber, Indigo, Teal, Mint, Coral
- Theme persists across sessions via localStorage
- Flash-free theme loading (IIFE in `<head>` applies theme before paint)

### Data Export
- CSV export with UTF-8 BOM for Excel compatibility
- Excel (XLSX) export via SheetJS with auto-column-width
- Multi-sheet workbook support
- Available for: marks/grades, attendance, homework, statistics

### UI & UX
- Fully responsive design (desktop, tablet, mobile)
- Hamburger menu with slide-out sidebar on mobile
- Collapsible card sections with localStorage persistence
- Animated toast notification system (success, error, warning, info) with auto-dismiss
- Styled confirmation dialogs (replaces native browser `confirm()`)
- Teacher popover cards: click any teacher badge to see avatar, name, email (copy-to-clipboard), and subjects
- Student avatars throughout the interface (initials fallback when no photo)
- Loading states on all buttons during API calls
- Empty states for sections with no data
- Current period highlighting in timetable
- Color-coded grade badges, attendance indicators, and behavioral severity markers

### Accessibility
- Semantic HTML with `role="dialog"` and `aria-modal="true"` on all modals
- Label-input association via `for` attributes on all form labels
- Keyboard-navigable confirmation dialogs (auto-focus confirm button)
- Screen-reader-friendly toast notifications with close buttons
- High contrast color coding for grade and attendance status indicators

---

## Security & Data Protection

### Authentication

| Mechanism | Details |
|---|---|
| **Protocol** | JWT (JSON Web Token) via PyJWT |
| **Algorithm** | HS256 (HMAC-SHA256) |
| **Secret** | `JWT_SECRET` environment variable (required in production) |
| **Token lifetime** | 8 hours |
| **Token payload** | User ID, role, email, expiry, admin level (if admin), permissions (if admin) |
| **Client-side** | Token in `localStorage`, checked for expiry before every page load, cleared on logout |
| **Server-side** | Every API endpoint verifies `Authorization: Bearer <token>` header |

### Rate Limiting

| Endpoint | Limit | Method |
|---|---|---|
| `/api/login/` | 5 requests per minute per IP | `django-ratelimit` with `LocMemCache` |

Returns HTTP 429 on excess. Graceful fallback if ratelimit package is unavailable.

### Password Policy

| Rule | Enforcement |
|---|---|
| Minimum 8 characters | Backend (profile update + admin user creation) + Frontend (form validation + placeholder text) |
| Confirmation matching | Frontend (profile page requires typing password twice) |
| Auto-generated passwords | 10 characters, ambiguity-reduced alphabet (no 0/O/l/I confusion) |

### Data Isolation

| Principle | Implementation |
|---|---|
| **Students see only their own data** | Every query filters by `student_id = JWT.sub` on the server side |
| **Teachers own their grades** | Edit/delete checks `created_by_teacher_id = JWT.sub` |
| **Teachers own their homework** | Delete checks `teacher_id = JWT.sub` |
| **Teachers own their behavioral entries** | Delete checks `teacher_id = JWT.sub` |
| **Teachers own their substitutes** | Delete checks `substitute_teacher_id = JWT.sub` |
| **Admin permissions are database-verified** | Regular admin permissions re-read from DB on every request (not solely from JWT) |

### Admin Hierarchy Protection

| Rule | Enforced By |
|---|---|
| Master admin hidden from regular admins | Filtered in admin user listing |
| Regular admins cannot edit/delete higher-level admins | Level comparison in update/delete handlers |
| Only master admins can create regular admins | Caller level check on POST |

### Transport & Headers (Production)

| Header / Setting | Value |
|---|---|
| `SECURE_SSL_REDIRECT` | `True` |
| `SECURE_HSTS_SECONDS` | 31,536,000 (1 year) |
| `SECURE_HSTS_INCLUDE_SUBDOMAINS` | `True` |
| `SECURE_HSTS_PRELOAD` | `True` |
| `SESSION_COOKIE_SECURE` | `True` |
| `CSRF_COOKIE_SECURE` | `True` |
| `X_FRAME_OPTIONS` | `DENY` |
| `SECURE_BROWSER_XSS_FILTER` | `True` |
| `SECURE_CONTENT_TYPE_NOSNIFF` | `True` |
| `DATA_UPLOAD_MAX_MEMORY_SIZE` | 2.5 MB |

### CORS

| Environment | Allowed Origins |
|---|---|
| **Production** | `https://chartwell-e-diary.netlify.app` only |
| **Debug** | Also allows `localhost:3000`, `localhost:5500`, `localhost:8080` |

### Avatar Upload Security

- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp` only
- Maximum file size: 2 MB
- Stored in Supabase Storage with role-specific paths (`students/`, `teachers/`, `admins/`)
- Old avatars (all extensions) are deleted before uploading a new one

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla HTML / CSS / JavaScript (zero build step) |
| **Backend** | Python 3.11 · Django 4.2 · Gunicorn |
| **Database** | PostgreSQL via Supabase (custom `ediary_schema`) |
| **Auth** | Supabase Auth (sign-in) + custom JWT issuance (PyJWT) |
| **Storage** | Supabase Storage (public `avatars` bucket) |
| **Hosting – Frontend** | Netlify CDN |
| **Hosting – Backend** | Render (Web Service, 2 Gunicorn workers) |
| **Excel Export** | SheetJS (XLSX) via CDN |
| **Rate Limiting** | `django-ratelimit` with `LocMemCache` |
| **CORS** | `django-cors-headers` |

---

## Architecture

```
┌─────────────────┐         HTTPS/JSON          ┌──────────────────┐       supabase-py       ┌────────────────┐
│                 │ ───────────────────────────► │                  │ ────────────────────► │                │
│    Frontend     │                              │   Django REST    │                        │   Supabase     │
│   (Netlify)     │ ◄─────────────────────────── │   API (Render)   │ ◄──────────────────── │   PostgreSQL   │
│                 │                              │                  │                        │   + Storage    │
└─────────────────┘                              └──────────────────┘                        └────────────────┘
     Static HTML/CSS/JS                            Stateless, JWT-verified                     ediary_schema
     localStorage for auth                         Rate-limited login                          Supabase Auth
     10 color themes                               Security headers                           Public avatars bucket
```

**Data flow:**
1. User logs in → frontend sends credentials to Django API
2. Django verifies credentials with Supabase Auth, issues a custom JWT
3. Frontend stores JWT in `localStorage`, sends it with every API request
4. Django verifies JWT on each request, queries Supabase for data
5. Responses rendered client-side with vanilla JavaScript DOM manipulation

---

## Database Schema

The database lives in a custom Supabase schema called `ediary_schema`. Here's the complete table structure:

### Core Tables

| Table | Purpose | Key Columns |
|---|---|---|
| `classes` | School classes (e.g., 12A, 11B) | `class_name` (unique), `grade_level` |
| `subjects` | Academic subjects | `name` (unique), `color_code` |
| `grade_levels` | Grade code definitions | `grade_code` (PK), `description`, `numerical_weight` |

### User Tables

| Table | Purpose | Key Columns |
|---|---|---|
| `students` | Student records | `name`, `surname`, `class_id` (FK→classes), `default_password`, `profile_picture_url` |
| `teachers` | Teacher records | `name`, `surname`, `is_class_teacher`, `class_teacher_of_class_id` (FK→classes), `default_password`, `profile_picture_url` |
| `admins` | Admin records | `name`, `surname`, `admin_level` (master/regular), `permissions` (JSONB), `profile_picture_url` |

### Relationship Tables

| Table | Purpose | Key |
|---|---|---|
| `teacher_assignments` | Links teacher → subject → class | Composite PK `(teacher_id, subject_id, class_id)` |
| `student_subjects` | Enrolls student in subjects | Composite PK `(student_id, subject_id)`, optional `group_class_id` |

### Academic Data

| Table | Purpose | Key Columns |
|---|---|---|
| `grades` | Student grades | `student_id`, `subject_id`, `assessment_name`, `grade_code`, `percentage`, `category`, `term` (1/2), `created_by_teacher_id` |
| `attendance` | Attendance records | `student_id`, `class_id`, `subject_id`, `date_recorded`, `status` (Present/Absent/Late/Excused), `comment`, `topic`, `recorded_by_teacher_id` |
| `behavioral_entries` | Behavioral notes | `teacher_id`, `student_id`, `entry_type` (positive/negative/note), `severity` (low/medium/high), `content` |
| `homework` | Homework tasks | `teacher_id`, `subject_id`, `class_id`, `title`, `description`, `due_date` |
| `homework_completions` | Per-student completion | `homework_id`, `student_id`, `status` (completed/partial/not_done), `recorded_by_teacher_id` |
| `teacher_reports` | Term reports | `teacher_id`, `student_id`, `subject_id`, `class_id`, `term`, `report_grade`, `effort`, `comment`. Unique on (teacher, student, subject, class, term) |
| `entries` | Personal diary | `user_id`, `subject_id`, `title`, `content`, `mood`, `entry_date` |

### Schedule & Sessions

| Table | Purpose | Key Columns |
|---|---|---|
| `schedule` | Master timetable | `teacher_id`, `subject_id`, `class_id`, `day_of_week` (1–5), `period` (1–8), `room`. Unique on (teacher_id, day_of_week, period) |
| `study_hall` | Study hall sessions | `teacher_id`, `date`, `period`, `room`. Unique on (teacher_id, date, period) |
| `study_hall_attendance` | Study hall attendance | `study_hall_id` (FK, CASCADE), `student_id`, `status`. Unique on (study_hall_id, student_id) |
| `substitutes` | Substitute lessons | `date`, `period`, `original_teacher_id`, `substitute_teacher_id`, `subject_id`, `class_id`, `room`, `note`, `topic`. Unique on (date, period, class_id) |

### Events & Holidays

| Table | Purpose | Key Columns |
|---|---|---|
| `events` | School events | `title`, `description`, `event_date`, `event_end_date`, `start_time`, `end_time`, `affected_periods` (JSONB), `target_type` (all/class/students), `target_class_ids`, `target_student_ids`, `target_teacher_ids` (all JSONB) |
| `holidays` | School holidays | `name`, `start_date`, `end_date` |

---

## API Reference

### Authentication & Profile (3 endpoints)

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/api/login/` | Email/password login. Returns JWT + user object. Rate-limited: 5/min per IP. | No |
| `GET / PATCH` | `/api/me/` | Get or update profile (email, password). | Yes |
| `POST` | `/api/me/avatar/` | Upload profile picture (multipart form). | Yes |

### Student Endpoints (8 endpoints)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/grades/` | All grades + enrolled subjects for the logged-in student |
| `GET` | `/api/subjects/` | Enrolled subjects list |
| `GET / POST` | `/api/diary/` | Personal diary entries (CRUD) |
| `GET` | `/api/attendance/` | Attendance records for the logged-in student |
| `GET` | `/api/schedule/` | Weekly timetable (student or teacher, role-aware) |
| `GET` | `/api/announcements/` | Homework assignments visible to the student |
| `GET` | `/api/behavioral/` | Behavioral entries (student sees own; teacher view also uses this) |
| `GET` | `/api/events/` | Events + holidays visible to the user |

### Teacher Endpoints (19 endpoints)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/teacher/class-students/` | Student roster for a class+subject |
| `GET / POST` | `/api/teacher/attendance/` | View or submit attendance records |
| `GET` | `/api/teacher/marks/` | Full marks data (class overview + subject groups) |
| `POST` | `/api/teacher/grades/add/` | Add a new grade |
| `PATCH` | `/api/teacher/grades/edit/` | Edit an existing grade (own grades only) |
| `DELETE` | `/api/teacher/grades/delete/` | Delete a grade (own grades only) |
| `POST` | `/api/teacher/homework/add/` | Add homework task |
| `POST` | `/api/teacher/homework/delete/` | Delete homework (own homework only) |
| `GET / POST` | `/api/teacher/homework/completions/` | Get or save homework completion status per student |
| `POST` | `/api/teacher/behavioral/add/` | Add a behavioral entry |
| `POST` | `/api/teacher/behavioral/delete/` | Delete a behavioral entry (own entries only) |
| `GET` | `/api/teacher/class-stats/` | Aggregate statistics for taught classes |
| `GET` | `/api/teacher/student-comments/` | Per-student comments timeline |
| `GET / POST` | `/api/teacher/reports/` | Semester reports (read + write) |
| `GET / POST` | `/api/teacher/study-hall/` | Study hall sessions (list + create) |
| `GET` | `/api/teacher/study-hall/students/` | Find students free at a given date+period |
| `POST` | `/api/teacher/study-hall/attendance/` | Save study hall attendance |
| `GET / POST / DELETE` | `/api/teacher/substitutes/` | Substitute lessons (list, create, delete) |
| `GET` | `/api/teacher/substitutes/classes/` | Available classes to substitute at a given date+period |
| `GET` | `/api/teacher/substitutes/detail/` | Substitute lesson detail + recorded attendance |

### Admin Endpoints (18 endpoints)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/stats/` | Overview statistics (counts of all entities) |
| `POST` | `/api/admin/impersonate/` | Generate impersonation token for a user |
| `GET / POST` | `/api/admin/classes/` | List or create classes |
| `PATCH / DELETE` | `/api/admin/classes/detail/` | Update or delete a class |
| `GET / POST` | `/api/admin/subjects/` | List or create subjects |
| `PATCH / DELETE` | `/api/admin/subjects/detail/` | Update or delete a subject |
| `GET / POST` | `/api/admin/users/` | List or create users (role specified as parameter) |
| `PATCH / DELETE` | `/api/admin/users/detail/` | Update or delete a user |
| `GET / POST` | `/api/admin/teacher-assignments/` | List or create teacher assignments |
| `DELETE` | `/api/admin/teacher-assignments/delete/` | Delete a teacher assignment |
| `GET / POST` | `/api/admin/student-subjects/` | List or create student-subject enrollments |
| `DELETE` | `/api/admin/student-subjects/delete/` | Delete a student enrollment |
| `GET / POST` | `/api/admin/schedule/` | List or create schedule slots |
| `PATCH / DELETE` | `/api/admin/schedule/detail/` | Update or delete a schedule slot |
| `POST` | `/api/admin/csv-import/` | Bulk CSV import (8 types with name-to-ID resolution) |
| `GET / POST` | `/api/admin/events/` | List or create events |
| `PATCH / DELETE` | `/api/admin/events/detail/` | Update or delete an event |
| `GET / POST` | `/api/admin/holidays/` | List or create holidays |
| `PATCH / DELETE` | `/api/admin/holidays/detail/` | Update or delete a holiday |
| `GET` | `/api/admin/attendance-flags/` | Attendance conflict detection |
| `GET` | `/api/admin/student-lookup/` | Comprehensive single-student data view |

---

## Theme System

The platform supports 10 color themes that affect the entire UI. Themes are implemented using CSS custom properties defined in `themes.css`.

| Theme | Primary Color | Data Attribute |
|---|---|---|
| Bright Blue (default) | `#2563eb` | — |
| Ocean | `#0369a1` | `data-theme="ocean"` |
| Purple | `#7c3aed` | `data-theme="purple"` |
| Emerald | `#059669` | `data-theme="emerald"` |
| Rose | `#e11d48` | `data-theme="rose"` |
| Amber | `#d97706` | `data-theme="amber"` |
| Indigo | `#4338ca` | `data-theme="indigo"` |
| Teal | `#0d9488` | `data-theme="teal"` |
| Mint | `#10b981` | `data-theme="mint"` |
| Coral | `#f97316` | `data-theme="coral"` |

Each theme overrides approximately 60 CSS custom properties covering all UI elements: primary colors, text colors, backgrounds, gradients, grade badge colors, status indicator colors, and more.

Themes are applied flash-free using an IIFE in the `<head>` that reads from `localStorage` and sets `data-theme` on `<html>` before the page paints.

---

## Project Structure

```
e-diary/
├── frontend/
│   ├── index.html                # Login page
│   ├── dashboard.html            # Student dashboard
│   ├── teacher.html              # Teacher dashboard (multi-tab)
│   ├── admin.html                # Admin panel
│   ├── marks.html                # Grade entry (teacher)
│   ├── report.html               # Term reports (teacher)
│   ├── grades.html               # Grade viewer (student)
│   ├── schedule.html             # Timetable (shared, role-aware)
│   ├── profile.html              # Profile & settings (shared)
│   ├── scripts/
│   │   ├── auth.js               # Authentication, API client, shared UI components
│   │   │                         #   (showToast, showConfirm, teacher popovers, nav)
│   │   ├── main.js               # Login page handler
│   │   ├── dashboard.js          # Student dashboard logic
│   │   ├── grades.js             # Student grade viewer
│   │   ├── schedule.js           # Timetable renderer
│   │   ├── teacher.js            # Teacher dashboard (all tabs)
│   │   ├── marks.js              # Marks table & grade editing
│   │   ├── report.js             # Term report management
│   │   ├── admin.js              # Admin panel (all sections)
│   │   ├── profile.js            # Profile page
│   │   ├── export-utils.js       # CSV/Excel export utilities
│   │   └── theme-loader.js       # Flash-free theme persistence (IIFE)
│   ├── styles/
│   │   ├── shared.css            # Global styles, components, dark mode, responsive
│   │   ├── themes.css            # 10 color theme definitions via CSS variables
│   │   └── loginPage.css         # Login page styles
│   └── images/
│       └── icon.png              # Application icon
├── backend/
│   ├── api/
│   │   ├── views.py              # All API endpoints (~4,700 lines)
│   │   ├── urls.py               # URL routing (37+ endpoints)
│   │   ├── supabase_client.py    # Supabase connection layer
│   │   ├── apps.py               # Django app config
│   │   └── __init__.py
│   ├── backend/
│   │   ├── settings.py           # Django settings (CORS, security, etc.)
│   │   ├── urls.py               # Root URL config
│   │   ├── wsgi.py               # WSGI entry point
│   │   └── __init__.py
│   ├── supabase_schema.sql       # Full database schema
│   ├── create_user.py            # User provisioning utility
│   ├── requirements.txt          # Python dependencies
│   └── manage.py                 # Django management
├── scripts/
│   └── fix_missing_enrollments.py  # Maintenance script
├── createUsers.py                # Batch user creation utility
├── render.yaml                   # Render deployment configuration
└── README.md                     # This file
```

---

## Setup & Deployment

### Prerequisites

- Python 3.11+
- A Supabase project (free tier works)
- A Render account (for backend hosting)
- A Netlify account (for frontend hosting)

### 1. Database Setup (Supabase)

1. Create a new project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor** and run the contents of `backend/supabase_schema.sql` to create all tables.
3. In the Supabase **Storage** section, create a public bucket named `avatars`.
4. Note your **Project URL** and **Service Role Key** from Settings → API.

### 2. Backend Setup (Render)

#### Environment Variables

| Variable | Description | Required |
|---|---|---|
| `SUPABASE_URL` | Your Supabase project URL (e.g., `https://xxxxx.supabase.co`) | Yes |
| `SUPABASE_SERVICE_KEY` | Supabase service role secret key | Yes |
| `JWT_SECRET` | Random string for signing JWT tokens (32+ chars recommended) | Yes |
| `DJANGO_SECRET_KEY` | Django secret key | Yes |
| `DEBUG` | Set to `False` in production | Recommended |

#### Local Development

```bash
cd backend
pip install -r requirements.txt

# Create a .env file with your variables
echo "SUPABASE_URL=https://xxxxx.supabase.co" >> .env
echo "SUPABASE_SERVICE_KEY=your-service-key" >> .env
echo "JWT_SECRET=your-jwt-secret" >> .env

python manage.py runserver
```

#### Deploy to Render

The included `render.yaml` configures automatic deployment:
- **Runtime:** Python 3.11.8
- **Root directory:** `backend/`
- **Build command:** `pip install -r requirements.txt`
- **Start command:** `gunicorn backend.wsgi:application --bind 0.0.0.0:$PORT --workers 2`

### 3. Frontend Setup (Netlify)

1. Deploy the `frontend/` directory to Netlify.
2. Update `API_BASE` in `frontend/scripts/auth.js` and `frontend/scripts/main.js` to point to your backend URL.
3. Update CORS in `backend/backend/settings.py` to allow your Netlify domain.

### 4. Initial Data Setup

Use the admin panel or the `createUsers.py` script to provision your first accounts:

```bash
# Create initial users via the backend utility
cd backend
python create_user.py
```

Or use the **CSV Bulk Import** feature in the admin panel to load classes, subjects, teachers, and students from CSV files.

---

## License

MIT
