# backend/users/views.py
# Plik udostępnia endpointy uwierzytelniania, operacji bezpieczeństwa konta i historii logowań.

from datetime import datetime, timezone as datetime_timezone

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.utils import timezone

from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from .models import AccountChangeToken, LoginEvent, PasswordResetToken, UserSession

User = get_user_model()

SAFE_RESET_RESPONSE = "Jeśli konto istnieje, wysłano e-mail."
INVALID_EMAIL_RESPONSE = "Nieprawidłowy adres e-mail."
INVALID_CREDENTIALS_RESPONSE = "Nieprawidłowy adres e-mail lub hasło."


# ===== Walidacja i normalizacja danych konta =====

def normalize_email(value) -> str:
    return str(value or "").strip().lower()


def is_valid_email(value: str) -> bool:
    try:
        validate_email(value)
    except DjangoValidationError:
        return False
    return True


def first_password_error(exc: DjangoValidationError) -> str:
    messages = exc.messages if hasattr(exc, "messages") else None
    if not messages:
        return "Hasło nie spełnia wymagań bezpieczeństwa."

    message = str(messages[0])
    normalized = message.lower()

    if "too short" in normalized:
        return "Hasło jest zbyt krótkie. Musi zawierać co najmniej 8 znaków."
    if "too common" in normalized:
        return "Hasło jest zbyt popularne."
    if "entirely numeric" in normalized:
        return "Hasło nie może składać się wyłącznie z cyfr."
    if "too similar" in normalized:
        return "Hasło jest zbyt podobne do danych konta."

    return message


# ===== Obsługa tokenów odświeżania =====

def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    response.set_cookie(
        key=settings.AUTH_REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=settings.AUTH_REFRESH_COOKIE_HTTPONLY,
        secure=settings.AUTH_REFRESH_COOKIE_SECURE,
        samesite=settings.AUTH_REFRESH_COOKIE_SAMESITE,
        path=settings.AUTH_REFRESH_COOKIE_PATH,
        domain=settings.AUTH_REFRESH_COOKIE_DOMAIN,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.AUTH_REFRESH_COOKIE_NAME,
        path=settings.AUTH_REFRESH_COOKIE_PATH,
        domain=settings.AUTH_REFRESH_COOKIE_DOMAIN,
        samesite=settings.AUTH_REFRESH_COOKIE_SAMESITE,
    )


def _get_refresh_from_request(request) -> str | None:
    cookie_value = request.COOKIES.get(settings.AUTH_REFRESH_COOKIE_NAME)
    if cookie_value:
        return str(cookie_value).strip()

    body_value = request.data.get("refresh")
    if body_value:
        return str(body_value).strip()

    return None


# ===== Historia logowań i bezpieczeństwo sesji =====

def _get_client_ip(request) -> str | None:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        parts = [item.strip() for item in forwarded.split(",") if item.strip()]
        if parts:
            return parts[0]

    remote = request.META.get("REMOTE_ADDR")
    return str(remote).strip() if remote else None


def _mask_ip(ip_value: str | None) -> str | None:
    if not ip_value:
        return None

    if ":" in ip_value:
        parts = ip_value.split(":")
        if len(parts) >= 4:
            return ":".join(parts[:3] + ["xxxx"])
        return "xxxx"

    parts = ip_value.split(".")
    if len(parts) == 4:
        return ".".join(parts[:2] + ["xxx", "xxx"])

    return ip_value


def _get_device_label(user_agent: str) -> str:
    ua = (user_agent or "").lower()

    if "android" in ua:
        system = "Android"
    elif "iphone" in ua or "ipad" in ua or "ios" in ua:
        system = "iOS"
    elif "windows" in ua:
        system = "Windows"
    elif "mac os" in ua or "macintosh" in ua:
        system = "macOS"
    elif "linux" in ua:
        system = "Linux"
    else:
        system = "Nieznany system"

    if "edg/" in ua:
        browser = "Edge"
    elif "chrome/" in ua and "edg/" not in ua:
        browser = "Chrome"
    elif "firefox/" in ua:
        browser = "Firefox"
    elif "safari/" in ua and "chrome/" not in ua:
        browser = "Safari"
    else:
        browser = "Nieznana przeglądarka"

    return f"{browser} na {system}"


def _blacklist_token_instance(token) -> None:
    BlacklistedToken.objects.get_or_create(token=token)


def _blacklist_all_user_tokens(user, exclude_jti: str | None = None) -> int:
    count = 0

    for outstanding in OutstandingToken.objects.filter(user=user):
        if exclude_jti and outstanding.jti == exclude_jti:
            continue

        _, created = BlacklistedToken.objects.get_or_create(token=outstanding)
        if created:
            count += 1

    return count


def _create_login_event(
    request,
    *,
    user=None,
    success: bool,
    failure_reason: str = "",
    login_identifier: str = "",
) -> None:
    LoginEvent.objects.create(
        user=user,
        success=success,
        ip_address=_get_client_ip(request),
        user_agent=str(request.META.get("HTTP_USER_AGENT") or "").strip(),
        failure_reason=str(failure_reason or "").strip(),
        login_identifier=str(login_identifier or "").strip(),
    )



def _get_refresh_jti(refresh_token) -> str | None:
    value = refresh_token.get("jti")
    return str(value) if value else None


def _get_refresh_expiration(refresh_token):
    exp = refresh_token.get("exp")
    if not exp:
        return None

    try:
        return datetime.fromtimestamp(int(exp), tz=datetime_timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def _create_or_touch_user_session(request, *, user, refresh_token) -> None:
    if not user:
        return

    jti = _get_refresh_jti(refresh_token)
    if not jti:
        return

    UserSession.objects.update_or_create(
        refresh_jti=jti,
        defaults={
            "user": user,
            "last_seen_at": timezone.now(),
            "expires_at": _get_refresh_expiration(refresh_token),
            "ip_address": _get_client_ip(request),
            "user_agent": str(request.META.get("HTTP_USER_AGENT") or "").strip(),
            "revoked_at": None,
        },
    )


def _touch_user_session(refresh_jti: str | None) -> None:
    if not refresh_jti:
        return

    UserSession.objects.filter(refresh_jti=refresh_jti, revoked_at__isnull=True).update(
        last_seen_at=timezone.now()
    )


def _revoke_user_session_by_jti(refresh_jti: str | None) -> None:
    if not refresh_jti:
        return

    UserSession.objects.filter(refresh_jti=refresh_jti, revoked_at__isnull=True).update(
        revoked_at=timezone.now()
    )


def _revoke_user_sessions(user, exclude_jti: str | None = None) -> int:
    queryset = UserSession.objects.filter(user=user, revoked_at__isnull=True)
    if exclude_jti:
        queryset = queryset.exclude(refresh_jti=exclude_jti)

    return queryset.update(revoked_at=timezone.now())


def _blacklist_refresh_jti(user, refresh_jti: str | None) -> bool:
    if not refresh_jti:
        return False

    outstanding = OutstandingToken.objects.filter(user=user, jti=refresh_jti).first()
    if not outstanding:
        return False

    _blacklist_token_instance(outstanding)
    return True


def _current_refresh_jti_from_request(request) -> str | None:
    refresh = _get_refresh_from_request(request)
    if not refresh:
        return None

    try:
        return _get_refresh_jti(RefreshToken(refresh))
    except Exception:
        return None


# ===== Potwierdzanie zmiany adresu e-mail =====

def _build_account_change_link(token_obj: AccountChangeToken) -> str:
    base = getattr(
        settings,
        "FRONTEND_ACCOUNT_CONFIRM_URL",
        "http://localhost:5173/account",
    ).rstrip("/")

    return f"{base}?token={token_obj.token}&type=email"


def _send_account_change_email(token_obj: AccountChangeToken) -> bool:
    link = _build_account_change_link(token_obj)
    subject = "Potwierdzenie zmiany adresu e-mail"
    message = (
        "Aby potwierdzić zmianę adresu e-mail w aplikacji turniejowej, kliknij w link:\n\n"
        f"{link}\n\n"
        "Jeżeli to nie była Twoja operacja, zignoruj tę wiadomość.\n"
        "Link jest ważny przez ograniczony czas."
    )

    try:
        send_mail(
            subject=subject,
            message=message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[token_obj.user.email],
            fail_silently=False,
        )
        return True
    except Exception:
        return False


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        return Response(
            {
                "id": user.id,
                "email": user.email,
                "is_staff": user.is_staff,
                "email_verified": None,
                "created_at": user.date_joined,
            }
        )


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        email = normalize_email(request.data.get("email"))
        password = str(request.data.get("password") or "")

        if not email or not password:
            return Response(
                {"detail": "Adres e-mail i hasło są wymagane."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not is_valid_email(email):
            return Response(
                {"detail": INVALID_EMAIL_RESPONSE},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = TokenObtainPairSerializer(
            data={
                "email": email,
                "password": password,
            }
        )

        try:
            serializer.is_valid(raise_exception=True)
        except AuthenticationFailed:
            user = User.objects.filter(email__iexact=email).first()
            _create_login_event(
                request,
                user=user,
                success=False,
                failure_reason="invalid_credentials",
                login_identifier=email,
            )
            return Response(
                {"detail": INVALID_CREDENTIALS_RESPONSE},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        access = serializer.validated_data.get("access")
        refresh = serializer.validated_data.get("refresh")

        if not access or not refresh:
            return Response(
                {"detail": "Nie udało się utworzyć sesji."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        refresh_token = RefreshToken(refresh)
        user = User.objects.filter(id=refresh_token["user_id"]).first()
        _create_login_event(
            request,
            user=user,
            success=True,
            login_identifier=email,
        )
        _create_or_touch_user_session(request, user=user, refresh_token=refresh_token)

        response = Response({"access": access}, status=status.HTTP_200_OK)
        _set_refresh_cookie(response, refresh)
        return response


class RefreshView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        refresh = _get_refresh_from_request(request)
        if not refresh:
            response = Response(
                {"detail": "Sesja wygasła lub token odświeżania jest nieobecny."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            _clear_refresh_cookie(response)
            return response

        try:
            old_refresh_token = RefreshToken(refresh)
            old_refresh_jti = _get_refresh_jti(old_refresh_token)
        except Exception:
            old_refresh_jti = None

        serializer = TokenRefreshSerializer(data={"refresh": refresh})

        try:
            serializer.is_valid(raise_exception=True)
        except (TokenError, ValidationError):
            response = Response(
                {"detail": "Sesja wygasła lub token odświeżania jest nieprawidłowy."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            _clear_refresh_cookie(response)
            return response

        access = serializer.validated_data.get("access")
        rotated_refresh = serializer.validated_data.get("refresh")

        if not access:
            response = Response(
                {"detail": "Nie udało się odświeżyć sesji."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            _clear_refresh_cookie(response)
            return response

        response = Response({"access": access}, status=status.HTTP_200_OK)

        if rotated_refresh:
            _revoke_user_session_by_jti(old_refresh_jti)
            _set_refresh_cookie(response, rotated_refresh)

            try:
                rotated_token = RefreshToken(rotated_refresh)
                user = User.objects.filter(id=rotated_token["user_id"]).first()
                _create_or_touch_user_session(request, user=user, refresh_token=rotated_token)
            except Exception:
                pass
        else:
            _touch_user_session(old_refresh_jti)
            _set_refresh_cookie(response, refresh)

        return response


class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        email = normalize_email(request.data.get("email"))
        password = request.data.get("password")

        if not email or not password:
            return Response(
                {"detail": "Adres e-mail i hasło są wymagane."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not is_valid_email(email):
            return Response(
                {"detail": INVALID_EMAIL_RESPONSE},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if User.objects.filter(email__iexact=email).exists():
            return Response(
                {"detail": "Użytkownik z tym adresem e-mail już istnieje."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = User(email=email)

        try:
            validate_password(password, user=user)
        except DjangoValidationError as exc:
            return Response(
                {"detail": first_password_error(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = User.objects.create_user(
            email=email,
            password=password,
        )

        return Response(
            {
                "id": user.id,
                "email": user.email,
            },
            status=status.HTTP_201_CREATED,
        )


class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        email = normalize_email(request.data.get("email"))

        if not email:
            return Response(
                {"detail": "Adres e-mail jest wymagany."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not is_valid_email(email):
            return Response(
                {"detail": INVALID_EMAIL_RESPONSE},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = User.objects.filter(email__iexact=email).first()
        if not user:
            return Response(
                {"detail": SAFE_RESET_RESPONSE},
                status=status.HTTP_200_OK,
            )

        PasswordResetToken.objects.filter(user=user).delete()
        token = PasswordResetToken.objects.create(user=user)

        reset_link = f"{settings.FRONTEND_RESET_URL}?token={token.token}"

        try:
            send_mail(
                subject="Reset hasła - aplikacja turniejowa",
                message=(
                    "Aby ustawić nowe hasło, kliknij w link:\n\n"
                    f"{reset_link}\n\n"
                    "Link jest ważny przez 1 godzinę."
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=False,
            )
        except Exception:
            token.delete()
            return Response(
                {"detail": SAFE_RESET_RESPONSE},
                status=status.HTTP_200_OK,
            )

        return Response(
            {"detail": SAFE_RESET_RESPONSE},
            status=status.HTTP_200_OK,
        )


class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        token_value = request.data.get("token")
        new_password = request.data.get("new_password")

        if not token_value or not new_password:
            return Response(
                {"detail": "Token i nowe hasło są wymagane."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            token = PasswordResetToken.objects.select_related("user").get(token=token_value)
        except PasswordResetToken.DoesNotExist:
            return Response(
                {
                    "detail": (
                        "Link do resetu hasła jest nieprawidłowy, "
                        "wygasł lub został już wykorzystany."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not token.is_valid():
            token.delete()
            return Response(
                {
                    "detail": (
                        "Link do resetu hasła wygasł. "
                        "Poproś o wygenerowanie nowego linku."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            validate_password(new_password, user=token.user)
        except DjangoValidationError as exc:
            return Response(
                {"detail": first_password_error(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = token.user
        user.set_password(new_password)
        user.save(update_fields=["password"])
        token.delete()

        return Response(
            {"detail": "Hasło zostało zmienione. Możesz się zalogować."},
            status=status.HTTP_200_OK,
        )


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        current_password = str(request.data.get("current_password") or "")
        new_password = str(request.data.get("new_password") or "")

        if not current_password or not new_password:
            return Response(
                {"detail": "Aktualne hasło i nowe hasło są wymagane."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user

        if not user.check_password(current_password):
            return Response(
                {"detail": "Aktualne hasło jest nieprawidłowe."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            validate_password(new_password, user=user)
        except DjangoValidationError as exc:
            return Response(
                {"detail": first_password_error(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(new_password)
        user.save(update_fields=["password"])

        AccountChangeToken.objects.filter(user=user).delete()
        _blacklist_all_user_tokens(user)
        _revoke_user_sessions(user)

        response = Response(
            {
                "detail": (
                    "Hasło zostało zmienione. "
                    "Wszystkie sesje zostały unieważnione."
                )
            },
            status=status.HTTP_200_OK,
        )
        _clear_refresh_cookie(response)
        return response


class ChangeEmailView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        new_email = normalize_email(request.data.get("new_email"))
        current_password = str(request.data.get("current_password") or "")
        user = request.user

        if not new_email or not current_password:
            return Response(
                {"detail": "Nowy adres e-mail i aktualne hasło są wymagane."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not is_valid_email(new_email):
            return Response(
                {"detail": INVALID_EMAIL_RESPONSE},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not user.check_password(current_password):
            return Response(
                {"detail": "Aktualne hasło jest nieprawidłowe."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if normalize_email(user.email) == new_email:
            return Response(
                {"detail": "Nowy adres e-mail musi różnić się od obecnego."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if User.objects.filter(email__iexact=new_email).exclude(id=user.id).exists():
            return Response(
                {"detail": "Użytkownik z tym adresem e-mail już istnieje."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        AccountChangeToken.objects.filter(user=user).delete()

        token_obj = AccountChangeToken.objects.create(
            user=user,
            new_value=new_email,
        )

        if not _send_account_change_email(token_obj):
            token_obj.delete()
            return Response(
                {"detail": "Nie udało się wysłać wiadomości potwierdzającej."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {"detail": "Wysłano wiadomość potwierdzającą na obecny adres e-mail."},
            status=status.HTTP_200_OK,
        )


class ConfirmEmailChangeView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        token_value = request.data.get("token")

        if not token_value:
            return Response(
                {"detail": "Token jest wymagany."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            token_obj = AccountChangeToken.objects.select_related("user").get(token=token_value)
        except AccountChangeToken.DoesNotExist:
            return Response(
                {"detail": "Link potwierdzający jest nieprawidłowy lub został już wykorzystany."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not token_obj.is_valid():
            token_obj.delete()
            return Response(
                {"detail": "Link potwierdzający wygasł. Rozpocznij operację ponownie."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        new_email = normalize_email(token_obj.new_value)
        if not is_valid_email(new_email):
            token_obj.delete()
            return Response(
                {"detail": INVALID_EMAIL_RESPONSE},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if User.objects.filter(email__iexact=new_email).exclude(id=token_obj.user_id).exists():
            token_obj.delete()
            return Response(
                {"detail": "Użytkownik z tym adresem e-mail już istnieje."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = token_obj.user
        user.email = new_email
        user.save(update_fields=["email"])
        token_obj.mark_consumed()

        return Response(
            {"detail": "Adres e-mail został zmieniony."},
            status=status.HTTP_200_OK,
        )


class LoginEventsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            limit = int(request.query_params.get("limit", 20))
        except ValueError:
            limit = 20

        limit = max(1, min(limit, 100))

        events = LoginEvent.objects.filter(user=request.user)[:limit]

        return Response(
            {
                "results": [
                    {
                        "id": event.id,
                        "created_at": event.created_at,
                        "success": event.success,
                        "ip_masked": _mask_ip(event.ip_address),
                        "device_label": _get_device_label(event.user_agent),
                        "user_agent": event.user_agent,
                        "failure_reason": event.failure_reason,
                    }
                    for event in events
                ]
            }
        )


class UserSessionsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        current_jti = _current_refresh_jti_from_request(request)
        blacklisted_jtis = set(
            BlacklistedToken.objects.filter(token__user=request.user).values_list("token__jti", flat=True)
        )

        sessions = (
            UserSession.objects.filter(user=request.user, revoked_at__isnull=True)
            .exclude(refresh_jti__in=blacklisted_jtis)
            .order_by("-last_seen_at", "-created_at")
        )

        now = timezone.now()
        results = []
        for session in sessions:
            if session.expires_at and session.expires_at <= now:
                continue

            results.append(
                {
                    "id": session.id,
                    "created_at": session.created_at,
                    "last_seen_at": session.last_seen_at,
                    "expires_at": session.expires_at,
                    "ip_masked": _mask_ip(session.ip_address),
                    "device_label": _get_device_label(session.user_agent),
                    "user_agent": session.user_agent,
                    "current": bool(current_jti and session.refresh_jti == current_jti),
                }
            )

        return Response({"results": results}, status=status.HTTP_200_OK)


class UserSessionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, session_id: int):
        session = UserSession.objects.filter(
            id=session_id,
            user=request.user,
            revoked_at__isnull=True,
        ).first()

        if not session:
            return Response({"detail": "Nie znaleziono aktywnej sesji."}, status=status.HTTP_404_NOT_FOUND)

        _blacklist_refresh_jti(request.user, session.refresh_jti)
        session.mark_revoked()

        response = Response(status=status.HTTP_204_NO_CONTENT)
        if _current_refresh_jti_from_request(request) == session.refresh_jti:
            _clear_refresh_cookie(response)

        return response


class LogoutOthersView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        refresh = _get_refresh_from_request(request)
        current_jti = None

        if refresh:
            try:
                current_jti = str(RefreshToken(refresh).get("jti"))
            except Exception:
                current_jti = None

        blacklisted_count = _blacklist_all_user_tokens(request.user, exclude_jti=current_jti)
        revoked_sessions_count = _revoke_user_sessions(request.user, exclude_jti=current_jti)

        return Response(
            {
                "detail": "Wylogowano z pozostałych urządzeń.",
                "blacklisted_count": blacklisted_count,
                "revoked_sessions_count": revoked_sessions_count,
            },
            status=status.HTTP_200_OK,
        )


class LogoutAllView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        blacklisted_count = _blacklist_all_user_tokens(request.user)
        revoked_sessions_count = _revoke_user_sessions(request.user)

        response = Response(
            {
                "detail": "Wylogowano ze wszystkich urządzeń.",
                "blacklisted_count": blacklisted_count,
                "revoked_sessions_count": revoked_sessions_count,
            },
            status=status.HTTP_200_OK,
        )
        _clear_refresh_cookie(response)
        return response


class LogoutView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        refresh = _get_refresh_from_request(request)

        if refresh:
            try:
                token = RefreshToken(refresh)
                _revoke_user_session_by_jti(_get_refresh_jti(token))
                token.blacklist()
            except Exception:
                pass

        response = Response(
            {"detail": "Wylogowano."},
            status=status.HTTP_200_OK,
        )
        _clear_refresh_cookie(response)
        return response