<p align="center">
  <img src="frontend/images/icon.png" alt="E-Diary Logo" width="80">
</p>

<h1 align="center">E-Diary</h1>
<p align="center"><strong>A modern, full-stack school management platform</strong></p>
<p align="center">
  Built with Django &middot; Supabase &middot; Vanilla JS<br>
  <a href="https://chartwell-e-diary.netlify.app/">Live Demo</a>
</p>

---

## Overview

**E-Diary** is a web-based school management system that streamlines daily academic workflows for students, teachers, and administrators. It provides real-time grade tracking, attendance monitoring, homework management, behavioral logging, timetable viewing, and term report generation — all within a clean, responsive interface.

The platform is designed to be **lightweight, fast, and easy to deploy** — no heavyweight JavaScript frameworks, no complex build pipelines. Just clean code that works.

---

## Key Features

### For Students
- **Dashboard** — Announcements feed and recent grades at a glance
- **Grades** — All grades grouped by subject with running averages and predicted outcomes
- **Schedule** — Full weekly timetable displayed as an interactive grid
- **Profile** — Personal information and academic overview

### For Teachers
- **Dashboard** — Today's classes, homework tasks, behavioral notes, and live class statistics with visual ring charts
- **Marks** — Assessment-based grade entry table organized by class/group, with inline editing and per-student expandable stats (attendance, grades, homework completion, behavioral summary)
- **Reports** — Term-based report writer (Winter / End of Year) organized by class with collapsible sections per subject
- **Attendance** — Session-based attendance tracking with student roster per class
- **Schedule** — Personal teaching timetable

### Platform
- **Role-based access** — Student, Teacher, and Admin roles with scoped data visibility
- **JWT authentication** — Secure token-based sessions with automatic expiry
- **Theme support** — Light and dark mode with smooth transitions
- **Responsive design** — Works on desktop, tablet, and mobile
- **Real-time stats** — Auto-refreshing dashboard with live data polling

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla HTML / CSS / JavaScript |
| **Backend** | Python · Django 4 · Gunicorn |
| **Database** | PostgreSQL via Supabase |
| **Auth** | JWT (PyJWT) + bcrypt password hashing |
| **Hosting** | Netlify (frontend) · Render (backend) |

---

## Architecture

```
┌─────────────┐     HTTPS/JSON      ┌──────────────┐      PostgREST       ┌───────────┐
│   Frontend   │ ──────────────────► │   Django API  │ ──────────────────► │  Supabase  │
│  (Netlify)   │ ◄────────────────── │   (Render)    │ ◄────────────────── │ PostgreSQL │
└─────────────┘                      └──────────────┘                      └───────────┘
```

- **Frontend** → Static HTML/CSS/JS served from Netlify CDN
- **Backend** → Django REST API on Render (stateless, JWT-verified)
- **Database** → Supabase PostgreSQL with custom `ediary_schema` namespace

---

## Project Structure

```
e-diary/
├── frontend/
│   ├── index.html              # Login page
│   ├── dashboard.html          # Student dashboard
│   ├── teacher.html            # Teacher dashboard
│   ├── marks.html              # Grade entry (teacher)
│   ├── report.html             # Term reports (teacher)
│   ├── grades.html             # Grade viewer (student)
│   ├── schedule.html           # Timetable
│   ├── profile.html            # User profile
│   ├── scripts/                # All JavaScript modules
│   │   ├── auth.js             # Authentication & API client
│   │   ├── teacher.js          # Teacher dashboard logic
│   │   ├── marks.js            # Marks table & grade editing
│   │   ├── report.js           # Term report management
│   │   ├── dashboard.js        # Student dashboard
│   │   ├── grades.js           # Student grade viewer
│   │   ├── schedule.js         # Timetable renderer
│   │   ├── profile.js          # Profile page
│   │   └── theme-loader.js     # Theme persistence
│   ├── styles/
│   │   ├── shared.css          # Global styles & components
│   │   ├── themes.css          # Light/dark theme variables
│   │   └── loginPage.css       # Login page styles
│   └── images/
├── backend/
│   ├── api/
│   │   ├── views.py            # All API endpoints
│   │   ├── urls.py             # URL routing
│   │   └── supabase_client.py  # Database connection layer
│   ├── backend/
│   │   ├── settings.py         # Django configuration
│   │   ├── urls.py             # Root URL config
│   │   └── wsgi.py             # WSGI entry point
│   ├── supabase_schema.sql     # Full database schema
│   ├── create_user.py          # User provisioning utility
│   ├── requirements.txt        # Python dependencies
│   └── manage.py               # Django management
└── render.yaml                 # Render deployment config
```

---

## Setup & Deployment

### 1. Database (Supabase)

1. Create a project at [supabase.com](https://supabase.com)
2. Run `backend/supabase_schema.sql` in the SQL Editor to create all tables
3. Run `backend/supabase_migration_20260401_teacher_reports.sql` for the reports feature
4. Use `backend/create_user.py` to provision your first admin/teacher/student accounts

### 2. Backend (Render)

| Environment Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role secret key |
| `JWT_SECRET` | Random string for signing JWT tokens |
| `DJANGO_SECRET_KEY` | Django secret key |

```bash
# Local development
cd backend
pip install -r requirements.txt
python manage.py runserver
```

Deploy to Render via the included `render.yaml`, or manually:
- **Root directory:** `backend/`
- **Build:** `pip install -r requirements.txt`
- **Start:** `gunicorn backend.wsgi:application --bind 0.0.0.0:$PORT`

### 3. Frontend (Netlify)

1. Deploy the `frontend/` folder to Netlify
2. Set `API_BASE` in `frontend/scripts/auth.js` to your backend URL
3. Ensure CORS is configured in `backend/backend/settings.py`

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/login/` | Authenticate and receive JWT |
| `GET` | `/api/student/dashboard/` | Student announcements & recent grades |
| `GET` | `/api/student/grades/` | All grades by subject |
| `GET` | `/api/student/schedule/` | Weekly timetable |
| `GET` | `/api/student/profile/` | Student profile data |
| `GET` | `/api/teacher/dashboard/` | Teacher's daily overview |
| `GET` | `/api/teacher/marks/` | Marks data for all taught classes |
| `POST` | `/api/teacher/grade/` | Submit or update a grade |
| `GET/POST` | `/api/teacher/reports/` | Term report read/write |
| `GET` | `/api/teacher/schedule/` | Teacher's timetable |
| `GET` | `/api/teacher/class-students/` | Student roster per class |
| `POST` | `/api/teacher/attendance/` | Record attendance |
| `GET` | `/api/teacher/class-stats/` | Per-class statistics |
| `POST` | `/api/teacher/homework/` | Create homework |
| `POST` | `/api/teacher/behavioral/` | Log behavioral entry |

---

## License

MIT
