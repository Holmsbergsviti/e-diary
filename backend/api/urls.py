from django.urls import path
from .views import login, me, grades, subjects, diary_entries, attendance, schedule, announcements

urlpatterns = [
    path("login/", login),
    path("me/", me),
    path("grades/", grades),
    path("subjects/", subjects),
    path("diary/", diary_entries),
    path("attendance/", attendance),
    path("schedule/", schedule),
    path("announcements/", announcements),
]
