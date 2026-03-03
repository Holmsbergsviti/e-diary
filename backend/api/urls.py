from django.urls import path
from .views import login, me, grades, diary_entries, schedule, announcements

urlpatterns = [
    path("login/", login),
    path("me/", me),
    path("grades/", grades),
    path("diary/", diary_entries),
    path("schedule/", schedule),
    path("announcements/", announcements),
]
