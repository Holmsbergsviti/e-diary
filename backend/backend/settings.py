from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = "django-insecure-9$h3#2j_!@Hshd8s9a8s7d"

DEBUG = True

ALLOWED_HOSTS = [
    "127.0.0.1",
    "localhost",
    ".onrender.com",
]

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "api",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "backend.urls"

TEMPLATES = []  # NOT USING DJANGO TEMPLATES

WSGI_APPLICATION = "backend.wsgi.application"

DATABASES = {}  # ❌ No Django DB

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"

STATIC_URL = "/static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
