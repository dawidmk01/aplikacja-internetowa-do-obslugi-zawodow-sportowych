# backend/users/admin.py
# Plik konfiguruje panel administracyjny Django dla kont użytkowników i modeli bezpieczeństwa.

from django import forms
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.forms import ReadOnlyPasswordHashField
from django.db.models import Count, Q
from django.utils import timezone

from .models import AccountChangeToken, LoginEvent, PasswordResetToken, User, UserSession


class LoginEventInline(admin.TabularInline):
    # Inline udostępnia ostatnie zdarzenia logowania bez opuszczania widoku konta użytkownika.
    model = LoginEvent
    extra = 0
    can_delete = False
    fields = (
        "created_at",
        "success",
        "login_identifier",
        "ip_address",
        "failure_reason",
        "short_user_agent",
    )
    readonly_fields = fields
    ordering = ("-created_at",)
    show_change_link = True

    @admin.display(description="Device")
    def short_user_agent(self, obj: LoginEvent) -> str:
        return shorten(obj.user_agent)

    def has_add_permission(self, request, obj=None):
        return False


class UserSessionInline(admin.TabularInline):
    # Inline pokazuje aktywność sesji powiązanych z kontem i ułatwia diagnostykę JWT.
    model = UserSession
    extra = 0
    can_delete = False
    fields = (
        "device_label",
        "ip_address",
        "created_at",
        "last_seen_at",
        "expires_at",
        "revoked_at",
        "is_currently_active",
    )
    readonly_fields = fields
    ordering = ("-last_seen_at", "-created_at")
    show_change_link = True

    @admin.display(description="Device")
    def device_label(self, obj: UserSession) -> str:
        return shorten(obj.user_agent)

    @admin.display(boolean=True, description="Active")
    def is_currently_active(self, obj: UserSession) -> bool:
        return obj.is_active

    def has_add_permission(self, request, obj=None):
        return False


class PasswordResetTokenInline(admin.TabularInline):
    # Inline pozwala sprawdzić ważność tokenów resetu hasła powiązanych z kontem.
    model = PasswordResetToken
    extra = 0
    can_delete = False
    fields = ("token", "created_at", "expires_at", "is_currently_valid")
    readonly_fields = fields
    ordering = ("-created_at",)
    show_change_link = True

    @admin.display(boolean=True, description="Valid")
    def is_currently_valid(self, obj: PasswordResetToken) -> bool:
        return obj.is_valid()

    def has_add_permission(self, request, obj=None):
        return False


class AccountChangeTokenInline(admin.TabularInline):
    # Inline pokazuje tokeny zmiany adresu e-mail jako element audytu konta.
    model = AccountChangeToken
    extra = 0
    can_delete = False
    fields = (
        "new_value",
        "token",
        "created_at",
        "expires_at",
        "consumed_at",
        "is_currently_valid",
    )
    readonly_fields = fields
    ordering = ("-created_at",)
    show_change_link = True

    @admin.display(boolean=True, description="Valid")
    def is_currently_valid(self, obj: AccountChangeToken) -> bool:
        return obj.is_valid()

    def has_add_permission(self, request, obj=None):
        return False


class EmailUserCreationForm(forms.ModelForm):
    # Formularz tworzenia konta wymusza ustawienie hasła zgodnie z modelem e-mail-only.
    password1 = forms.CharField(label="Password", widget=forms.PasswordInput)
    password2 = forms.CharField(label="Repeat password", widget=forms.PasswordInput)

    class Meta:
        model = User
        fields = ("email", "is_active", "is_staff", "is_superuser")

    def clean_password2(self):
        password1 = self.cleaned_data.get("password1")
        password2 = self.cleaned_data.get("password2")

        if password1 and password2 and password1 != password2:
            raise forms.ValidationError("Passwords do not match.")

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


# ===== Funkcje pomocnicze admina =====


def shorten(value: str | None, limit: int = 80) -> str:
    text = str(value or "").strip()
    if not text:
        return "No data"
    return text[:limit] + ("..." if len(text) > limit else "")


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    # Konfiguracja usuwa zależność panelu administracyjnego od pola username.
    form = EmailUserChangeForm
    add_form = EmailUserCreationForm

    list_display = (
        "email",
        "is_active",
        "is_staff",
        "is_superuser",
        "active_sessions_count",
        "date_joined",
        "last_login",
    )
    list_filter = ("is_active", "is_staff", "is_superuser", "groups")
    search_fields = ("email",)
    ordering = ("email",)
    filter_horizontal = ("groups", "user_permissions")
    readonly_fields = ("date_joined", "last_login")
    inlines = (
        UserSessionInline,
        LoginEventInline,
        PasswordResetTokenInline,
        AccountChangeTokenInline,
    )
    actions = ("activate_users", "deactivate_users")

    fieldsets = (
        ("Account", {"fields": ("email", "password")}),
        ("Status", {"fields": ("is_active", "is_staff", "is_superuser")}),
        ("Permissions", {"fields": ("groups", "user_permissions")}),
        ("Dates", {"fields": ("date_joined", "last_login")}),
    )

    add_fieldsets = (
        (
            "New account",
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

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        now = timezone.now()
        return qs.annotate(
            _active_sessions_count=Count(
                "sessions",
                filter=(
                    Q(sessions__revoked_at__isnull=True)
                    & (Q(sessions__expires_at__isnull=True) | Q(sessions__expires_at__gte=now))
                ),
                distinct=True,
            )
        )

    @admin.display(description="Active sessions", ordering="_active_sessions_count")
    def active_sessions_count(self, obj: User) -> int:
        return int(getattr(obj, "_active_sessions_count", 0) or 0)

    @admin.action(description="Activate selected accounts")
    def activate_users(self, request, queryset):
        queryset.update(is_active=True)

    @admin.action(description="Deactivate selected accounts")
    def deactivate_users(self, request, queryset):
        queryset.update(is_active=False)


@admin.register(PasswordResetToken)
class PasswordResetTokenAdmin(admin.ModelAdmin):
    # Widok administracyjny umożliwia kontrolę jednorazowych tokenów resetu hasła.
    list_display = ("user", "token", "created_at", "expires_at", "is_currently_valid")
    list_filter = ("created_at", "expires_at")
    search_fields = ("user__email", "token")
    readonly_fields = ("user", "token", "created_at", "expires_at", "is_currently_valid")
    raw_id_fields = ("user",)
    list_select_related = ("user",)
    ordering = ("-created_at",)

    @admin.display(boolean=True, description="Valid")
    def is_currently_valid(self, obj: PasswordResetToken) -> bool:
        return obj.is_valid()

    def has_add_permission(self, request):
        return False


@admin.register(AccountChangeToken)
class AccountChangeTokenAdmin(admin.ModelAdmin):
    # Widok administracyjny wspiera diagnostykę tokenów potwierdzających zmianę adresu e-mail.
    list_display = (
        "user",
        "new_value",
        "token",
        "created_at",
        "expires_at",
        "consumed_at",
        "is_currently_valid",
    )
    list_filter = ("created_at", "expires_at", "consumed_at")
    search_fields = ("user__email", "new_value", "token")
    readonly_fields = (
        "user",
        "new_value",
        "token",
        "created_at",
        "expires_at",
        "consumed_at",
        "is_currently_valid",
    )
    raw_id_fields = ("user",)
    list_select_related = ("user",)
    ordering = ("-created_at",)

    @admin.display(boolean=True, description="Valid")
    def is_currently_valid(self, obj: AccountChangeToken) -> bool:
        return obj.is_valid()

    def has_add_permission(self, request):
        return False


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
    raw_id_fields = ("user",)
    list_select_related = ("user",)
    ordering = ("-created_at",)

    @admin.display(description="Device")
    def short_user_agent(self, obj: LoginEvent) -> str:
        return shorten(obj.user_agent)

    def has_add_permission(self, request):
        return False


@admin.register(UserSession)
class UserSessionAdmin(admin.ModelAdmin):
    # Widok administracyjny pozwala diagnozować aktywne i unieważnione sesje użytkowników.
    list_display = (
        "user",
        "device_label",
        "ip_address",
        "created_at",
        "last_seen_at",
        "expires_at",
        "revoked_at",
        "is_currently_active",
    )
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
        "is_currently_active",
    )
    raw_id_fields = ("user",)
    list_select_related = ("user",)
    ordering = ("-last_seen_at", "-created_at")
    actions = ("revoke_sessions",)

    @admin.display(boolean=True, description="Active")
    def is_currently_active(self, obj: UserSession) -> bool:
        return obj.is_active

    @admin.display(description="Device")
    def device_label(self, obj: UserSession) -> str:
        return shorten(obj.user_agent)

    @admin.action(description="Revoke selected sessions")
    def revoke_sessions(self, request, queryset):
        queryset.filter(revoked_at__isnull=True).update(revoked_at=timezone.now())

    def has_add_permission(self, request):
        return False
