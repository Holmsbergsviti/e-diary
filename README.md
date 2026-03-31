
# Chartwell International School E-Diary

CS students replicating and improving [online.chartwell.edu.rs](https://www.online.chartwell.edu.rs/login).

**Live demo:** [https://chartwell-e-diary.netlify.app/](https://chartwell-e-diary.netlify.app/)

---

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

| Layer     | Technology                                      |
|-----------|-------------------------------------------------|
| Frontend  | Vanilla HTML / CSS / JavaScript (Netlify)       |
| Backend   | Django 4 + Gunicorn (Render)                    |
| Database  | Supabase (PostgreSQL)                           |
| Auth      | JWT tokens (PyJWT) + bcrypt password hashing    |

---


## Setup & Deployment

### 1 – Supabase Database

1. Create a new project at [supabase.com](https://supabase.com).
2. In the **SQL Editor**, run the contents of `backend/supabase_schema.sql` to set up tables.
3. Use `backend/create_user.py` to add your first user (see script for usage).

### 2 – Backend (Django on Render)


#### Environment variables (set these in Render dashboard):

| Variable                | Description                                 |
|-------------------------|---------------------------------------------|
| `SUPABASE_URL`          | Your Supabase project URL                   |
| `SUPABASE_SERVICE_KEY`  | Supabase **service role** secret key        |
| `JWT_SECRET`            | Long random string for JWT signing          |
| `DJANGO_SECRET_KEY`     | Django secret key                           |

#### Local development:

```bash
cd backend
pip install -r requirements.txt
python manage.py runserver
```

#### Deploying to Render:

1. Create a new **Web Service** on Render, connect your repo, and set the root directory to `backend/`.
2. Set the environment variables above in the Render dashboard.
3. Use the following build and start commands:
	- **Build Command:** `pip install -r requirements.txt`
	- **Start Command:** `gunicorn backend.wsgi`
4. After deployment, note your Render backend URL (e.g., `https://your-backend.onrender.com`).

### 3 – Frontend (Netlify)

1. Deploy the `frontend/` folder to Netlify (drag-and-drop or connect via GitHub).
2. In `frontend/scripts/main.js` and `frontend/scripts/auth.js`, set the `API_BASE` variable to your Render backend URL (e.g., `https://your-backend.onrender.com`).
3. Redeploy if you change the API URL.

---

## Troubleshooting & Tips

- If you see CORS errors, ensure your Render backend allows requests from your Netlify domain.
- For local testing, set `API_BASE` to `http://localhost:8000`.
- Make sure your Supabase credentials are correct and have the right permissions.

---

## License

MIT
