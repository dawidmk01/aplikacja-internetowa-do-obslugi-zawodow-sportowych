from django.contrib.auth import get_user_model
from django.conf import settings
from django.core.mail import send_mail
from django.shortcuts import get_object_or_404

from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status

from .models import PasswordResetToken

User = get_user_model()


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        u = request.user
        return Response({
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "is_staff": u.is_staff,
        })


class RegisterView(APIView):
    """
    Rejestracja nowego użytkownika.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        username = request.data.get("username")
        email = request.data.get("email")
        password = request.dataget("password") if hasattr(request, "dataget") else request.data.get("password")

        if not username or not email or not password:
            return Response(
                {"detail": "Wszystkie pola są wymagane."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if User.objects.filter(username=username).exists():
            return Response(
                {"detail": "Nazwa użytkownika jest już zajęta."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if User.objects.filter(email=email).exists():
            return Response(
                {"detail": "Użytkownik z tym e-mailem już istnieje."},
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
    """
    Wysyła e-mail z linkiem do resetu hasła.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        email = request.data.get("email")

        if not email:
            return Response(
                {"detail": "Adres e-mail jest wymagany."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Ochrona przed enumeracją użytkowników
        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return Response(
                {"detail": "Jeśli konto istnieje, wysłano e-mail."},
                status=status.HTTP_200_OK,
            )

        # Usunięcie poprzednich tokenów
        PasswordResetToken.objects.filter(user=user).delete()

        token = PasswordResetToken.objects.create(user=user)

        reset_link = (
            f"{settings.FRONTEND_RESET_URL}"
            f"?token={token.token}"
        )

        send_mail(
            subject="Reset hasła – aplikacja turniejowa",
            message=(
                "Aby ustawić nowe hasło, kliknij w link:\n\n"
                f"{reset_link}\n\n"
                "Link jest ważny przez 1 godzinę."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )

        return Response(
            {"detail": "Jeśli konto istnieje, wysłano e-mail."},
            status=status.HTTP_200_OK,
        )

class PasswordResetConfirmView(APIView):
    """
    Ustawienie nowego hasła na podstawie tokenu.
    """
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
            token = PasswordResetToken.objects.get(token=token_value)
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

        user = token.user
        user.set_password(new_password)
        user.save()

        # 🔐 jednorazowość linku
        token.delete()

        return Response(
            {"detail": "Hasło zostało zmienione. Możesz się zalogować."},
            status=status.HTTP_200_OK,
        )

