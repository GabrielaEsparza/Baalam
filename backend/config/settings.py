"""Configuración de BÁALAM GYM. Todo lo sensible sale de variables de entorno."""
import os
import re
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BASE_DIR.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).lower() in {"1", "true", "yes", "on"}


DEBUG = env_bool("DEBUG", True)
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-insecure-change-me" if DEBUG else "")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY es obligatoria en producción")
QR_SECRET = os.environ.get("QR_SECRET", SECRET_KEY)

ALLOWED_HOSTS = [h for h in os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h]
CSRF_TRUSTED_ORIGINS = [
    o for o in os.environ.get("CSRF_TRUSTED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "apps.accounts",
    "apps.memberships",
    "apps.schedule",
    "apps.checkin",
    "apps.training",
    "apps.progress",
    "apps.podium",
    "apps.community",
    "apps.nutrition",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

# El build de React (frontend/dist) se sirve desde Django.
FRONTEND_DIST = Path(os.environ.get("FRONTEND_DIST", REPO_DIR / "frontend" / "dist"))

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [FRONTEND_DIST],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}", conn_max_age=600, conn_health_checks=True
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
]

LANGUAGE_CODE = "es-mx"
TIME_ZONE = os.environ.get("TIME_ZONE", "America/Mexico_City")
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [FRONTEND_DIST] if FRONTEND_DIST.exists() else []
WHITENOISE_ROOT = FRONTEND_DIST if FRONTEND_DIST.exists() else None
# En producción el build de React se sirve desde STATIC_ROOT, donde collectstatic dejó
# copias .gz/.br: se mandan comprimidas (menos datos = menos costo y carga más rápido).
if not DEBUG and (STATIC_ROOT / "index.html").exists():
    WHITENOISE_ROOT = STATIC_ROOT
# Los archivos de Vite llevan hash en el nombre (assets/index-AbC123xY.js): el navegador
# los guarda para siempre y no los vuelve a pedir hasta que cambie la versión.
_HASHED = re.compile(r"^/?(static/)?assets/.+[.-][\w-]{8,}\.\w+$")
WHITENOISE_IMMUTABLE_FILE_TEST = lambda path, url: bool(_HASHED.match(url))  # noqa: E731

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

if os.environ.get("BUCKET_NAME"):
    STORAGES["default"] = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": os.environ["BUCKET_NAME"],
            "endpoint_url": os.environ.get("BUCKET_ENDPOINT"),
            "access_key": os.environ.get("BUCKET_ACCESS_KEY_ID"),
            "secret_key": os.environ.get("BUCKET_SECRET_ACCESS_KEY"),
            "querystring_auth": True,  # URLs firmadas: las fotos son privadas
            "file_overwrite": False,
        },
    }

# Sesión en cookie + CSRF (mismo dominio para React y API)
SESSION_COOKIE_AGE = 60 * 60 * 24 * 60  # 60 días: el miembro no debe loguearse cada vez
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False  # React lee la cookie para mandar X-CSRFToken
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Correo (Resend vía anymail); en desarrollo se imprime en consola.
if os.environ.get("RESEND_API_KEY"):
    EMAIL_BACKEND = "anymail.backends.resend.EmailBackend"
    ANYMAIL = {"RESEND_API_KEY": os.environ["RESEND_API_KEY"]}
else:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "BÁALAM GYM <no-reply@baalam.gym>")

# USDA FoodData Central: pide una key gratis en https://fdc.nal.usda.gov/api-key-signup
# DEMO_KEY solo sirve para probar (≈30 consultas/hora por IP).
USDA_API_KEY = os.environ.get("USDA_API_KEY", "DEMO_KEY")
# Días que se guardan los registros de comida; el cron nightly borra lo más viejo.
NUTRITION_RETENTION_DAYS = int(os.environ.get("NUTRITION_RETENTION_DAYS", "30"))

EXERCISEDB_BASE_URL = os.environ.get("EXERCISEDB_BASE_URL", "https://oss.exercisedb.dev/api/v1")

# Caché compartida entre workers y reinicios (catálogo de ejercicios). Requiere `createcachetable`.
CACHES = {"default": {"BACKEND": "django.core.cache.backends.db.DatabaseCache", "LOCATION": "baalam_cache"}}

LOGGING = {
    "version": 1,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}

WHITENOISE_MIMETYPES = {".webmanifest": "application/manifest+json"}
