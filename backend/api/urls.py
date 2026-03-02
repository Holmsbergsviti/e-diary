from django.urls import path
from .views import login, me, grades, schedule, announcements

urlpatterns = [
    path("login/", login),
    path("me/", me),
    path("grades/", grades),
    path("schedule/", schedule),
    path("announcements/", announcements),
]
