# Chartwell International School E-Diary

CS students replicating and improving [online.chartwell.edu.rs](https://www.online.chartwell.edu.rs/login).

Live demo: <https://chartwell-e-diary.netlify.app/>

---

## Features

| Page | Description |
|---|---|
| **Login** | Username + password authentication with JWT sessions |
| **Dashboard** | Announcements feed and recent grades at a glance |
| **Schedule** | Full weekly timetable displayed as a grid |
| **Grades** | All grades grouped by subject with averages |
| **Profile** | Student info pulled from the database |

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML / CSS / JavaScript (hosted on Netlify) |
| Backend | Django 4 + Gunicorn (hosted on Render) |
| Database | Supabase (PostgreSQL) |
| Auth | JWT tokens (PyJWT) + bcrypt password hashing |

---

## Setup

### 1 – Supabase database

1. Create a new project at [supabase.com](https://supabase.com).
2. In the **SQL Editor**, run the contents of `backend/supabase_schema.sql`.
3. Use `backend/create_user.py` to add your first user.

### 2 – Backend (Django on Render)

Required environment variables:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Your Supabase **service role** secret key |
| `JWT_SECRET` | A long random string used to sign JWT tokens |
| `DJANGO_SECRET_KEY` | Django secret key |

```bash
cd backend
pip install -r requirements.txt
python manage.py runserver   # local dev
```

### 3 – Frontend (Netlify)

Deploy the `frontend/` folder to Netlify (drag-and-drop or connect via GitHub).

The `API_BASE` URL in `frontend/scripts/main.js` and `frontend/scripts/auth.js` points to the Render backend — update it if you host elsewhere.
