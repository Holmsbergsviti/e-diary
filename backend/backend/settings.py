from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = "dev-secret-key"
DEBUG = False

ALLOWED_HOSTS = [
    "e-diary-backend-lwpj.onrender.com",
]

INSTALLED_APPS = [
    'corsheaders',
    'api',   # ✅ JUST THIS
]


MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
]

CORS_ALLOWED_ORIGINS = ["https://chartwell-e-diary.netlify.app/"]

ROOT_URLCONF = 'backend.urls'

WSGI_APPLICATION = 'backend.wsgi.application'

DATABASES = {}  # MongoDB used directly

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
STATIC_URL = '/static/'
