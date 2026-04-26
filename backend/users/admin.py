# backend/users/admin.py
# Plik konfiguruje panel administracyjny Django dla kont użytkowników i modeli bezpieczeństwa.

from django import forms
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.forms import ReadOnlyPasswordHashField

from .models import AccountChangeToken, LoginEvent, PasswordResetToken, User, UserSession


class EmailUserCreationForm(forms.ModelForm):
    # Formularz tworzenia konta wymusza ustawienie hasła zgodnie z modelem e-mail-only.
    password1 = forms.CharField(label="Hasło", widget=forms.PasswordInput)
    password2 = forms.CharField(label="Powtórz hasło", widget=forms.PasswordInput)

    class Meta:
        model = User
        fields = ("email", "is_active", "is_staff", "is_superuser")

    def clean_password2(self):
        password1 = self.cleaned_data.get("password1")
        password2 = self.cleaned_data.get("password2")

        if password1 and password2 and password1 != password2:
            raise forms.ValidationError("Hasła nie są identyczne.")

        return password2

    def save(self, commit=True):
        user = super().save(commit=False)
        user.email = User.objects._normalize_email(user.email)
        user.set_password(self.cleaned_data["password1"])

        if commit:
            user.save()

        return user


class EmailUserChangeForm(forms.ModelForm):
    # Formularz edycji konta prezentuje zahashowane hasło bez możliwości jego bezpośredniej edycji.
    password = ReadOnlyPasswordHashField(label="Hasło")

    class Meta:
        model = User
        fields = (
            "email",
            "password",
            "is_active",
            "is_staff",
            "is_superuser",
            "groups",
            "user_permissions",
        )


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    # Konfiguracja usuwa zależność panelu administracyjnego od pola username.
    form = EmailUserChangeForm
    add_form = EmailUserCreationForm

    list_display = ("email", "is_active", "is_staff", "is_superuser", "date_joined", "last_login")
    list_filter = ("is_active", "is_staff", "is_superuser", "groups")
    search_fields = ("email",)
    ordering = ("email",)
    filter_horizontal = ("groups", "user_permissions")

    fieldsets = (
        ("Konto", {"fields": ("email", "password")}),
        ("Status", {"fields": ("is_active", "is_staff", "is_superuser")}),
        ("Uprawnienia", {"fields": ("groups", "user_permissions")}),
        ("Daty", {"fields": ("date_joined", "last_login")}),
    )

    add_fieldsets = (
        (
            "Nowe konto",
            {
                "classes": ("wide",),
                "fields": (
                    "email",
                    "password1",
                    "password2",
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                ),
            },
        ),
    )

    readonly_fields = ("date_joined", "last_login")


@admin.register(PasswordResetToken)
class PasswordResetTokenAdmin(admin.ModelAdmin):
    # Widok administracyjny umożliwia kontrolę jednorazowych tokenów resetu hasła.
    list_display = ("user", "token", "created_at", "expires_at", "is_currently_valid")
    list_filter = ("created_at", "expires_at")
    search_fields = ("user__email", "token")
    readonly_fields = ("token", "created_at", "expires_at")
    list_select_related = ("user",)
    ordering = ("-created_at",)

    @admin.display(boolean=True, description="Ważny")
    def is_currently_valid(self, obj: PasswordResetToken) -> bool:
        return obj.is_valid()


@admin.register(AccountChangeToken)
class AccountChangeTokenAdmin(admin.ModelAdmin):
    # Widok administracyjny wspiera diagnostykę tokenów potwierdzających zmianę adresu e-mail.
    list_display = ("user", "new_value", "token", "created_at", "expires_at", "consumed_at", "is_currently_valid")
    list_filter = ("created_at", "expires_at", "consumed_at")
    search_fields = ("user__email", "new_value", "token")
    readonly_fields = ("token", "created_at", "expires_at", "consumed_at")
    list_select_related = ("user",)
    ordering = ("-created_at",)

    @admin.display(boolean=True, description="Ważny")
    def is_currently_valid(self, obj: AccountChangeToken) -> bool:
        return obj.is_valid()


@admin.register(LoginEvent)
class LoginEventAdmin(admin.ModelAdmin):
    # Widok administracyjny prezentuje historię logowań jako dane audytowe konta.
    list_display = (
        "created_at",
        "user",
        "success",
        "login_identifier",
        "ip_address",
        "failure_reason",
        "short_user_agent",
    )
    list_filter = ("success", "created_at", "failure_reason")
    search_fields = ("user__email", "login_identifier", "ip_address", "user_agent")
    readonly_fields = (
        "user",
        "created_at",
        "success",
        "ip_address",
        "user_agent",
        "login_identifier",
        "failure_reason",
    )
    list_select_related = ("user",)
    ordering = ("-created_at",)

    @admin.display(description="Urządzenie")
    def short_user_agent(self, obj: LoginEvent) -> str:
        value = str(obj.user_agent or "").strip()
        if not value:
            return "Brak danych"

        return value[:80] + ("..." if len(value) > 80 else "")

    def has_add_permission(self, request):
        return False


@admin.register(UserSession)
class UserSessionAdmin(admin.ModelAdmin):
    # Widok administracyjny pozwala diagnozować aktywne i unieważnione sesje użytkowników.
    list_display = ("user", "device_label", "ip_address", "created_at", "last_seen_at", "expires_at", "revoked_at", "is_active")
    list_filter = ("created_at", "last_seen_at", "expires_at", "revoked_at")
    search_fields = ("user__email", "refresh_jti", "ip_address", "user_agent")
    readonly_fields = (
        "user",
        "refresh_jti",
        "created_at",
        "last_seen_at",
        "expires_at",
        "ip_address",
        "user_agent",
        "revoked_at",
    )
    list_select_related = ("user",)
    ordering = ("-last_seen_at", "-created_at")

    @admin.display(boolean=True, description="Aktywna")
    def is_active(self, obj: UserSession) -> bool:
        return obj.is_active

    @admin.display(description="Urządzenie")
    def device_label(self, obj: UserSession) -> str:
        value = str(obj.user_agent or "").strip()
        if not value:
            return "Brak danych"

        return value[:80] + ("..." if len(value) > 80 else "")

    def has_add_permission(self, request):
        return False
