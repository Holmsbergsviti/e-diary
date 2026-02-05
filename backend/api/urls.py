# backend/api/urls.py (Add this path)

from django.urls import path
from . import views

urlpatterns = [
    # ... existing paths ...
    path('teacher/dashboard/', views.teacher_dashboard_data, name='api_teacher_dashboard'),
]