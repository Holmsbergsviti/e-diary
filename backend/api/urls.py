from django.urls import path
from .views import (
    login, me, grades, subjects, diary_entries, attendance, schedule,
    announcements, teacher_class_students, teacher_attendance, teacher_marks,
    teacher_add_grade, teacher_edit_grade, teacher_delete_grade,
    teacher_add_homework, teacher_delete_homework,
)

urlpatterns = [
    path("login/", login),
    path("me/", me),
    path("grades/", grades),
    path("subjects/", subjects),
    path("diary/", diary_entries),
    path("attendance/", attendance),
    path("schedule/", schedule),
    path("announcements/", announcements),
    path("teacher/class-students/", teacher_class_students),
    path("teacher/attendance/", teacher_attendance),
    path("teacher/marks/", teacher_marks),
    path("teacher/grades/add/", teacher_add_grade),
    path("teacher/grades/edit/", teacher_edit_grade),
    path("teacher/grades/delete/", teacher_delete_grade),
    path("teacher/homework/add/", teacher_add_homework),
    path("teacher/homework/delete/", teacher_delete_homework),
]
