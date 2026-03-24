# backend/users/urls.py
# Plik mapuje endpointy uwierzytelniania i operacji bezpieczeństwa konta użytkownika.

from django.urls import path

from .views import (
    ChangeEmailView,
    ChangePasswordView,
    ChangeUsernameView,
    ConfirmEmailChangeView,
    ConfirmUsernameChangeView,
    LoginEventsView,
    LoginView,
    LogoutAllView,
    LogoutOthersView,
    LogoutView,
    MeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    RefreshView,
    RegisterView,
)

urlpatterns = [
    path("login/", LoginView.as_view(), name="token_obtain_pair"),
    path("refresh/", RefreshView.as_view(), name="token_refresh"),
    path("logout/", LogoutView.as_view(), name="token_logout"),
    path("logout-others/", LogoutOthersView.as_view(), name="logout-others"),
    path("logout-all/", LogoutAllView.as_view(), name="logout-all"),
    path("me/", MeView.as_view(), name="me"),
    path("register/", RegisterView.as_view(), name="register"),
    path("password-reset/", PasswordResetRequestView.as_view(), name="password-reset"),
    path(
        "password-reset/confirm/",
        PasswordResetConfirmView.as_view(),
        name="password-reset-confirm",
    ),
    path("change-password/", ChangePasswordView.as_view(), name="change-password"),
    path("change-email/", ChangeEmailView.as_view(), name="change-email"),
    path(
        "confirm-email-change/",
        ConfirmEmailChangeView.as_view(),
        name="confirm-email-change",
    ),
    path("change-username/", ChangeUsernameView.as_view(), name="change-username"),
    path(
        "confirm-username-change/",
        ConfirmUsernameChangeView.as_view(),
        name="confirm-username-change",
    ),
    path("login-events/", LoginEventsView.as_view(), name="login-events"),
]