# backend/tournaments/access.py
# Plik centralizuje helpery dostępu i uprawnień dla domeny turniejowej.

from __future__ import annotations

from collections.abc import Iterable
from typing import Any, Optional

from .models import Tournament, TournamentMembership, TournamentRegistration


ORGANIZER_ONLY_PERMISSION_KEYS: set[str] = {
    TournamentMembership.PERM_PUBLISH,
    TournamentMembership.PERM_ARCHIVE,
    TournamentMembership.PERM_MANAGE_ASSISTANTS,
    TournamentMembership.PERM_JOIN_SETTINGS,
}

PERMISSIONS_RESPONSE_KEYS: list[str] = [
    TournamentMembership.PERM_TEAMS_EDIT,
    TournamentMembership.PERM_SCHEDULE_EDIT,
    TournamentMembership.PERM_RESULTS_EDIT,
    TournamentMembership.PERM_BRACKET_EDIT,
    TournamentMembership.PERM_TOURNAMENT_EDIT,
    TournamentMembership.PERM_ROSTER_EDIT,
    TournamentMembership.PERM_NAME_CHANGE_APPROVE,
    TournamentMembership.PERM_PUBLISH,
    TournamentMembership.PERM_ARCHIVE,
    TournamentMembership.PERM_MANAGE_ASSISTANTS,
    TournamentMembership.PERM_JOIN_SETTINGS,
]


def _is_authenticated(user) -> bool:
    return bool(user and getattr(user, "is_authenticated", False))


def _normalize_args(user_or_tournament: Any, tournament_or_user: Any) -> tuple[Any, Tournament]:
    if isinstance(user_or_tournament, Tournament):
        tournament = user_or_tournament
        user = tournament_or_user
    else:
        user = user_or_tournament
        tournament = tournament_or_user

    return user, tournament


def get_assistant_membership(
    user,
    tournament: Tournament,
    *,
    statuses: Iterable[str] | None = None,
) -> Optional[TournamentMembership]:
    if not _is_authenticated(user):
        return None

    qs = TournamentMembership.objects.filter(
        tournament=tournament,
        user=user,
        role=TournamentMembership.Role.ASSISTANT,
    )

    if statuses is not None:
        qs = qs.filter(status__in=list(statuses))

    return qs.order_by("id").first()


def get_membership(user, tournament: Tournament) -> Optional[TournamentMembership]:
    return get_assistant_membership(
        user,
        tournament,
        statuses=(TournamentMembership.Status.ACCEPTED,),
    )


def get_pending_assistant_membership(user, tournament: Tournament) -> Optional[TournamentMembership]:
    return get_assistant_membership(
        user,
        tournament,
        statuses=(TournamentMembership.Status.PENDING,),
    )


def user_is_organizer(user, tournament: Tournament) -> bool:
    return _is_authenticated(user) and tournament.organizer_id == user.id


def user_is_assistant(user, tournament: Tournament) -> bool:
    return get_membership(user, tournament) is not None


def user_has_pending_assistant_invite(user, tournament: Tournament) -> bool:
    return get_pending_assistant_membership(user, tournament) is not None


def user_is_registered_participant(user, tournament: Tournament) -> bool:
    if not _is_authenticated(user):
        return False

    return TournamentRegistration.objects.filter(
        tournament=tournament,
        user=user,
    ).exists()


def participant_can_view_public_preview(tournament: Tournament) -> bool:
    return bool(
        getattr(tournament, "is_published", False)
        or getattr(tournament, "participants_public_preview_enabled", False)
    )


def user_can_view_tournament(user, tournament: Tournament) -> bool:
    if not _is_authenticated(user):
        return False

    if user_is_organizer(user, tournament):
        return True

    if user_is_assistant(user, tournament):
        return True

    if user_is_registered_participant(user, tournament):
        return participant_can_view_public_preview(tournament)

    return False


def _raw_permission_enabled(membership: TournamentMembership, perm_key: str) -> bool:
    raw_permissions = dict(membership.permissions or {})
    return bool(raw_permissions.get(perm_key, False))


def get_my_permissions(
    user,
    tournament: Tournament,
    allowed_keys: Iterable[str] | None = None,
) -> dict[str, bool]:
    keys = list(allowed_keys) if allowed_keys is not None else PERMISSIONS_RESPONSE_KEYS

    if user_is_organizer(user, tournament):
        return {key: True for key in keys}

    membership = get_membership(user, tournament)
    if not membership:
        return {key: False for key in keys}

    # W organizer-only asystent zachowuje podgląd, ale bez akcji edycyjnych.
    if tournament.entry_mode != Tournament.EntryMode.MANAGER:
        return {key: False for key in keys}

    return {
        key: False if key in ORGANIZER_ONLY_PERMISSION_KEYS else _raw_permission_enabled(membership, key)
        for key in keys
    }


def assistant_has_perm(user, tournament: Tournament, perm_key: str) -> bool:
    if not _is_authenticated(user):
        return False

    if user_is_organizer(user, tournament):
        return True

    membership = get_membership(user, tournament)
    if not membership:
        return False

    if tournament.entry_mode != Tournament.EntryMode.MANAGER:
        return False

    if perm_key in ORGANIZER_ONLY_PERMISSION_KEYS:
        return False

    return _raw_permission_enabled(membership, perm_key)


def user_can_manage_tournament(user_or_tournament, tournament_or_user) -> bool:
    user, tournament = _normalize_args(user_or_tournament, tournament_or_user)

    if not _is_authenticated(user):
        return False

    if user_is_organizer(user, tournament):
        return True

    if tournament.entry_mode != Tournament.EntryMode.MANAGER:
        return False

    return user_is_assistant(user, tournament)


def can_edit_teams(user, tournament: Tournament) -> bool:
    return assistant_has_perm(user, tournament, TournamentMembership.PERM_TEAMS_EDIT)


def can_edit_schedule(user, tournament: Tournament) -> bool:
    return assistant_has_perm(user, tournament, TournamentMembership.PERM_SCHEDULE_EDIT)


def can_edit_results(user, tournament: Tournament) -> bool:
    return assistant_has_perm(user, tournament, TournamentMembership.PERM_RESULTS_EDIT)


def can_edit_bracket(user, tournament: Tournament) -> bool:
    return assistant_has_perm(user, tournament, TournamentMembership.PERM_BRACKET_EDIT)


def can_edit_tournament_detail(user, tournament: Tournament) -> bool:
    return assistant_has_perm(user, tournament, TournamentMembership.PERM_TOURNAMENT_EDIT)


def can_edit_roster(user, tournament: Tournament) -> bool:
    return assistant_has_perm(user, tournament, TournamentMembership.PERM_ROSTER_EDIT)


def can_approve_name_changes(user, tournament: Tournament) -> bool:
    return assistant_has_perm(user, tournament, TournamentMembership.PERM_NAME_CHANGE_APPROVE)


def can_manage_assistants(user, tournament: Tournament) -> bool:
    return user_is_organizer(user, tournament)


def can_manage_join_settings(user, tournament: Tournament) -> bool:
    return user_is_organizer(user, tournament)


def can_view_assistant_permissions(user, tournament: Tournament, target_user_id: int) -> bool:
    if user_is_organizer(user, tournament):
        return True

    if not user_is_assistant(user, tournament):
        return False

    return bool(getattr(user, "id", None) == target_user_id)


def can_update_assistant_permissions(user, tournament: Tournament) -> bool:
    return user_is_organizer(user, tournament)