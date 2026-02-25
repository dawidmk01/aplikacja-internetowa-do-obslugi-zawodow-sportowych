# backend/config/settings.py
# Plik centralizuje konfigurację środowiska, bezpieczeństwa i integracji aplikacji Django.

import os
from datetime import timedelta
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def env_str(name: str, default: str = "") -> str:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip()


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise ImproperlyConfigured(f"{name} musi być liczbą całkowitą.") from exc


def env_list(name: str, default: list[str] | None = None) -> list[str]:
    value = os.getenv(name)
    if value is None:
        return list(default or [])
    return [item.strip() for item in value.split(",") if item.strip()]


DEBUG = env_bool("DJANGO_DEBUG", default=False)

SECRET_KEY = env_str("DJANGO_SECRET_KEY", "unsafe-default-change-me")
if not DEBUG and SECRET_KEY == "unsafe-default-change-me":
    raise ImproperlyConfigured("DJANGO_SECRET_KEY musi być ustawiony poza środowiskiem deweloperskim.")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

INSTALLED_APPS = [
    "corsheaders",
    "daphne",
    "channels",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "tournaments",
    "users",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env_str("POSTGRES_DB", "turnieje"),
        "USER": env_str("POSTGRES_USER", "turnieje"),
        "PASSWORD": env_str("POSTGRES_PASSWORD", "turnieje_dev_password"),
        "HOST": env_str("POSTGRES_HOST", "db"),
        "PORT": env_int("POSTGRES_PORT", 5432),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = env_str("DJANGO_LANGUAGE_CODE", "en-us")
TIME_ZONE = env_str("DJANGO_TIME_ZONE", "UTC")
USE_I18N = True
USE_TZ = True

STATIC_URL = env_str("DJANGO_STATIC_URL", "/static/")
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOWED_ORIGINS = env_list(
    "DJANGO_CORS_ALLOWED_ORIGINS",
    default=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
)
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS", default=CORS_ALLOWED_ORIGINS)
CORS_ALLOW_CREDENTIALS = False

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
}

PASSWORD_RESET_TOKEN_HOURS = env_int("PASSWORD_RESET_TOKEN_HOURS", 1)

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env_int("DJANGO_ACCESS_TOKEN_MINUTES", 15)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env_int("DJANGO_REFRESH_TOKEN_DAYS", 7)),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
}

REDIS_URL = env_str("REDIS_URL")
REDIS_HOST = env_str("REDIS_HOST", "redis")
REDIS_PORT = env_int("REDIS_PORT", 6379)

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [REDIS_URL] if REDIS_URL else [(REDIS_HOST, REDIS_PORT)],
        },
    }
}

EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = env_str("MAILTRAP_HOST", "sandbox.smtp.mailtrap.io")
EMAIL_PORT = env_int("MAILTRAP_PORT", 2525)
EMAIL_HOST_USER = env_str("MAILTRAP_USER")
EMAIL_HOST_PASSWORD = env_str("MAILTRAP_PASSWORD")
EMAIL_USE_TLS = env_bool("MAILTRAP_USE_TLS", False)
EMAIL_USE_SSL = env_bool("MAILTRAP_USE_SSL", False)
if EMAIL_USE_TLS and EMAIL_USE_SSL:
    raise ImproperlyConfigured("MAILTRAP_USE_TLS i MAILTRAP_USE_SSL nie mogą być włączone jednocześnie.")

DEFAULT_FROM_EMAIL = env_str("DEFAULT_FROM_EMAIL", "noreply@turnieje.local")
FRONTEND_RESET_URL = env_str(
    "FRONTEND_RESET_URL",
    "http://localhost:5173/reset-password",
)

X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"

if env_bool("DJANGO_TRUST_X_FORWARDED_PROTO", False):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

if DEBUG:
    SESSION_COOKIE_SECURE = False
    CSRF_COOKIE_SECURE = False
    SECURE_SSL_REDIRECT = False
    SECURE_HSTS_SECONDS = 0
    SECURE_HSTS_INCLUDE_SUBDOMAINS = False
    SECURE_HSTS_PRELOAD = False
else:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", False)
    SECURE_HSTS_SECONDS = env_int("DJANGO_SECURE_HSTS_SECONDS", 0)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS", False)
    SECURE_HSTS_PRELOAD = env_bool("DJANGO_SECURE_HSTS_PRELOAD", False)