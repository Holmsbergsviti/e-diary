<p align="center">
  <img src="frontend/images/icon.png" alt="E-Diary Logo" width="80">
</p>

<h1 align="center">Chartwell E-Diary</h1>
<p align="center"><strong>A full-stack school management system</strong></p>
<p align="center"><em>by Vladislav Salii and Stepan Atroshkin</em></p>

## What this is

Chartwell E-Diary is a full-stack school platform with a separated frontend and backend deployed independently:

- **Frontend:** static vanilla HTML/CSS/JS on Netlify
- **Backend:** Django API on Render
- **Database/Auth/Storage:** Supabase

Role-based access, timetable management, attendance, grading, homework, reports, substitutes, study hall, events, admin tooling.

## Demo

**Try it without an account:** <https://chartwell-e-diary.netlify.app/demo.html>

Pick Student, Teacher or Admin and explore a sample school (4 classes, 9 teachers, 24 students) with grades, attendance, homework, timetables, events and reports. You can also jump straight in with
`/?demo=student`, `/?demo=teacher` or `/?demo=admin`, or use the demo buttons on the login page.

The demo runs the real frontend against an in-browser mock of the API (`frontend/scripts/demo.js`), so it never touches Render or Supabase and loads instantly even when the backend is asleep. Changes are kept in the visitor's browser; the floating demo bar lets them switch role, reset the sample data or exit.

Production:

- Frontend: <https://chartwell-e-diary.netlify.app/>
- Backend API: <https://e-diary-backend-qsly.onrender.com/api>

## Core features

- **Student flow:** dashboard, grades, schedule, attendance view, behavioral notes, profile settings
- **Teacher flow:** attendance, marks, homework tracking, reports, substitutes, study hall, exports
- **Admin flow:** users, classes, subjects, schedule, events, holidays, imports, impersonation, attendance flags
- **Access control:** role-based routing plus server-side data scoping
- **UX polish:** toast notifications, styled confirmations, theme support, responsive layout

## Architecture

```text
Frontend (Netlify, vanilla JS)
        ↓ HTTPS / JSON
Backend (Django API on Render)
        ↓ supabase-py
Supabase (Postgres + Auth + Storage)
```

Why this matters:

- frontend and backend are independently deployable
- the backend is stateless and JWT-based
- Supabase is used as the data/auth/storage layer
- the project avoids a frontend build step entirely

More detail is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tech stack

| Layer | Stack |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript |
| Backend | Python 3.11, Django 4.2, Gunicorn |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth + custom JWT |
| Storage | Supabase Storage |
| Hosting | Netlify + Render |

## Run locally

### Backend

```bash
cd backend
pip install -r requirements.txt
python manage.py runserver
```

Required environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `JWT_SECRET`
- `DJANGO_SECRET_KEY`

### Frontend

Deploy or serve the `frontend/` folder and point `API_BASE` in the frontend scripts to your backend URL.

## Extra docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — roles, features, security, data model, project structure
- [docs/API.md](docs/API.md) — endpoint reference

## Authors

- Vladislav Salii
- Stepan Atroshkin

## License

MIT
