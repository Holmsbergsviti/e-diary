from django.urls import path
from .views import login, me, grades, attendance, schedule, announcements

urlpatterns = [
    path("login/", login),
    path("me/", me),
    path("grades/", grades),
    path("attendance/", attendance),
    path("schedule/", schedule),
    path("announcements/", announcements),
]
