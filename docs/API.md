# API Reference

Base URL in production: `https://e-diary-backend-qsly.onrender.com/api`

## Authentication & profile

| Method | Path | Description |
|---|---|---|
| POST | `/login/` | Email/password login. Returns JWT and user payload. |
| GET / PATCH | `/me/` | Read or update current user profile. |
| POST | `/me/avatar/` | Upload avatar image. |

## Student endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/grades/` | Student grades and enrolled subjects. |
| GET | `/subjects/` | Student subject list. |
| GET / POST | `/diary/` | Personal diary entries. |
| GET | `/attendance/` | Student attendance history. |
| GET | `/schedule/` | Weekly timetable. |
| GET | `/announcements/` | Homework visible to the student. |
| GET | `/behavioral/` | Behavioral entries. |
| GET | `/events/` | Public events and holidays. |

## Teacher endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/teacher/class-students/` | Student roster for a class + subject. |
| GET / POST | `/teacher/attendance/` | Read or submit attendance. |
| GET | `/teacher/marks/` | Marks overview and grouped student data. |
| POST | `/teacher/grades/add/` | Create grade. |
| PATCH | `/teacher/grades/edit/` | Edit grade. |
| DELETE | `/teacher/grades/delete/` | Delete grade. |
| POST | `/teacher/homework/add/` | Create homework. |
| POST | `/teacher/homework/delete/` | Delete homework. |
| GET / POST | `/teacher/homework/completions/` | Read or save homework completion states. |
| POST | `/teacher/behavioral/add/` | Create behavioral entry. |
| POST | `/teacher/behavioral/delete/` | Delete behavioral entry. |
| GET | `/teacher/class-stats/` | Aggregated class statistics. |
| GET | `/teacher/student-comments/` | Combined comment timeline per student. |
| GET / POST | `/teacher/reports/` | Read or save term reports. |
| GET / POST | `/teacher/study-hall/` | List or create study hall sessions. |
| GET | `/teacher/study-hall/students/` | Students free for study hall at a slot. |
| POST | `/teacher/study-hall/attendance/` | Save study hall attendance. |
| GET / POST / DELETE | `/teacher/substitutes/` | Substitute lesson CRUD. |
| GET | `/teacher/substitutes/classes/` | Available classes for substitution. |
| GET | `/teacher/substitutes/detail/` | Substitute detail and recorded attendance. |

## Admin endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/admin/stats/` | Admin dashboard counts. |
| POST | `/admin/impersonate/` | Generate impersonation token. |
| GET / POST | `/admin/classes/` | List or create classes. |
| PATCH / DELETE | `/admin/classes/detail/` | Update or delete class. |
| GET / POST | `/admin/subjects/` | List or create subjects. |
| PATCH / DELETE | `/admin/subjects/detail/` | Update or delete subject. |
| GET / POST | `/admin/users/` | List or create users. |
| PATCH / DELETE | `/admin/users/detail/` | Update or delete user. |
| GET / POST | `/admin/teacher-assignments/` | Manage teacher assignments. |
| DELETE | `/admin/teacher-assignments/delete/` | Delete teacher assignment. |
| GET / POST | `/admin/student-subjects/` | Manage student enrollments. |
| DELETE | `/admin/student-subjects/delete/` | Delete student enrollment. |
| GET / POST | `/admin/schedule/` | Manage schedule slots. |
| PATCH / DELETE | `/admin/schedule/detail/` | Update or delete schedule slot. |
| POST | `/admin/csv-import/` | Bulk CSV import. |
| GET / POST | `/admin/events/` | List or create events. |
| PATCH / DELETE | `/admin/events/detail/` | Update or delete event. |
| GET / POST | `/admin/holidays/` | List or create holidays. |
| PATCH / DELETE | `/admin/holidays/detail/` | Update or delete holiday. |
| GET | `/admin/attendance-flags/` | Attendance conflict detection. |
| GET | `/admin/student-lookup/` | Deep student lookup. |

## Notes

- Most endpoints require `Authorization: Bearer <token>`.
- Login is the only public endpoint.
- The canonical route list is in [backend/api/urls.py](../backend/api/urls.py).
