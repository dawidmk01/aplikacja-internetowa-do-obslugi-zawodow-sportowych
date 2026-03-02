# backend/users/views.py
# Plik udostępnia endpointy konta użytkownika, logowania, odświeżania sesji, resetu hasła i wylogowania.

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail

from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from .models import PasswordResetToken

User = get_user_model()

SAFE_RESET_RESPONSE = "Jeśli konto istnieje, wysłano e-mail."


def normalize_email(value) -> str:
    return str(value or "").strip().lower()


def first_password_error(exc: DjangoValidationError) -> str:
    messages = exc.messages if hasattr(exc, "messages") else None
    if messages:
        return str(messages[0])
    return "Hasło nie spełnia wymagań bezpieczeństwa."


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


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        return Response(
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "is_staff": user.is_staff,
            }
        )


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = TokenObtainPairSerializer(data=request.data)

        if not serializer.is_valid():
            return Response(
                {"detail": "Nieprawidłowy login lub hasło."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        access = serializer.validated_data.get("access")
        refresh = serializer.validated_data.get("refresh")

        if not access or not refresh:
            return Response(
                {"detail": "Nie udało się utworzyć sesji."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

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

        serializer = TokenRefreshSerializer(data={"refresh": refresh})

        # Blacklist, wygaśnięcie lub zły refresh mają zwracać kontrolowane 401.
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

        # Rotacja cookie utrzymuje refresh wyłącznie po stronie przeglądarki.
        if rotated_refresh:
            _set_refresh_cookie(response, rotated_refresh)
        else:
            _set_refresh_cookie(response, refresh)

        return response


class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = str(request.data.get("username") or "").strip()
        email = normalize_email(request.data.get("email"))
        password = request.data.get("password")

        if not username or not email or not password:
            return Response(
                {"detail": "Wszystkie pola są wymagane."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if User.objects.filter(username__iexact=username).exists():
            return Response(
                {"detail": "Nazwa użytkownika jest już zajęta."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if User.objects.filter(email__iexact=email).exists():
            return Response(
                {"detail": "Użytkownik z tym e-mailem już istnieje."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Walidacja hasła ma zatrzymać słabe hasła już na wejściu.
        try:
            validate_password(password)
        except DjangoValidationError as exc:
            return Response(
                {"detail": first_password_error(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = User.objects.create_user(
            username=username,
            email=email,
            password=password,
        )

        return Response(
            {
                "id": user.id,
                "username": user.username,
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

        # Stały komunikat ogranicza enumerację kont.
        user = User.objects.filter(email__iexact=email).first()
        if not user:
            return Response(
                {"detail": SAFE_RESET_RESPONSE},
                status=status.HTTP_200_OK,
            )

        # Stary token jest usuwany, aby działał tylko ostatni link.
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
            # Token jest czyszczony, aby nie zostawiać martwego linku.
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

        # Walidacja ma zatrzymać ustawienie słabego hasła po resecie.
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

        # Link resetu pozostaje jednorazowy.
        token.delete()

        return Response(
            {"detail": "Hasło zostało zmienione. Możesz się zalogować."},
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        refresh = _get_refresh_from_request(request)

        # Logout jest idempotentny i zawsze czyści cookie.
        if refresh:
            try:
                token = RefreshToken(refresh)
                token.blacklist()
            except Exception:
                pass

        response = Response(
            {"detail": "Wylogowano."},
            status=status.HTTP_200_OK,
        )
        _clear_refresh_cookie(response)
        return response