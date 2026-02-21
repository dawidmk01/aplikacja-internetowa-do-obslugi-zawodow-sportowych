# backend/tournaments/views/commentary.py
from __future__ import annotations

from django.db import transaction
from django.db.models import Case, F, IntegerField, Value, When
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.models import (
    Match,
    MatchCommentaryEntry,
    Tournament,
    TournamentCommentaryPhrase,
    TournamentMembership,
)


def _get_membership_perms(user, tournament: Tournament) -> dict | None:
    if not user or user.is_anonymous:
        return None
    if user.id == tournament.organizer_id:
        return {"__organizer__": True}
    m = TournamentMembership.objects.filter(tournament=tournament, user=user).first()
    if not m:
        return None
    return m.effective_permissions()


def _require_can_manage_commentary(user, tournament: Tournament) -> None:
    """
    Komentarze live są elementem wyników (results_edit).
    """
    perms = _get_membership_perms(user, tournament)
    if not perms:
        raise PermissionError("Brak uprawnień.")
    if perms.get("__organizer__"):
        return
    if perms.get(TournamentMembership.PERM_RESULTS_EDIT):
        return
    raise PermissionError("Brak uprawnień do relacji live.")


def _parse_int(v, field: str, allow_none: bool = True) -> int | None:
    if v is None or v == "":
        return None if allow_none else 0
    try:
        return int(v)
    except (TypeError, ValueError):
        raise ValueError(f"{field} musi być liczbą całkowitą.")


def _serialize_commentary_entry(e: MatchCommentaryEntry) -> dict:
    return {
        "id": e.id,
        "match_id": e.match_id,
        "period": e.period,
        "time_source": e.time_source,
        "minute": e.minute,
        "minute_raw": e.minute_raw,
        "text": e.text,
        "created_by": e.created_by_id,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


def _serialize_phrase(p: TournamentCommentaryPhrase) -> dict:
    return {
        "id": p.id,
        "tournament_id": p.tournament_id,
        "kind": p.kind,
        "category": p.category,
        "text": p.text,
        "order": int(p.order or 0),
        "is_active": bool(p.is_active),
        "created_by": p.created_by_id,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


class MatchCommentaryListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        # Publiczny podgląd relacji live (TournamentPublic) może działać bez logowania.
        # Weryfikacja dostępu (is_published + access_code) jest w get().
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [AllowAny()]
        return [IsAuthenticated()]

    def get(self, request, match_id: int):
        """
        LISTA komentarzy live dla meczu.

        Tryby:
        - panel (autoryzowany): wymagane results_edit (lub organizer)
        - public: dozwolone tylko gdy turniej jest opublikowany
          + jeśli turniej ma access_code, wymagamy ?code=<access_code>
        """

        match = get_object_or_404(Match.objects.select_related("tournament"), pk=match_id)

        can_manage = False
        if request.user and getattr(request.user, "is_authenticated", False):
            try:
                _require_can_manage_commentary(request.user, match.tournament)
                can_manage = True
            except PermissionError:
                can_manage = False

        if not can_manage:
            t = match.tournament
            if not getattr(t, "is_published", False):
                return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

            access_code = getattr(t, "access_code", None)
            if access_code:
                provided = request.query_params.get("code")
                if provided != access_code:
                    return Response({"detail": "Nieprawidłowy kod dostępu."}, status=status.HTTP_403_FORBIDDEN)

        qs = (
            MatchCommentaryEntry.objects.select_related("match__tournament")
            .filter(match_id=match_id)
            .annotate(
                _no_minute=Case(
                    When(minute__isnull=True, then=Value(0)),
                    default=Value(1),
                    output_field=IntegerField(),
                )
            )
            .order_by("_no_minute", F("minute").desc(nulls_last=True), F("id").desc())
        )
        return Response([_serialize_commentary_entry(x) for x in qs])

    def post(self, request, match_id: int):
        with transaction.atomic():
            match = get_object_or_404(
                Match.objects.select_related("tournament").select_for_update(),
                pk=match_id,
            )

            try:
                _require_can_manage_commentary(request.user, match.tournament)
            except PermissionError as e:
                return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

            data = request.data or {}

            text = (data.get("text") or "").strip()
            if not text:
                return Response({"detail": "Wymagane pole text."}, status=status.HTTP_400_BAD_REQUEST)

            time_source = (data.get("time_source") or MatchCommentaryEntry.TimeSource.CLOCK).strip()
            if time_source not in (MatchCommentaryEntry.TimeSource.CLOCK, MatchCommentaryEntry.TimeSource.MANUAL):
                return Response({"detail": "time_source musi być CLOCK albo MANUAL."}, status=status.HTTP_400_BAD_REQUEST)

            try:
                minute = _parse_int(data.get("minute"), "minute", allow_none=True)
            except ValueError as e:
                return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

            minute_raw = (data.get("minute_raw") or "").strip() or None

            # CLOCK + brak minuty => policz z zegara
            if time_source == MatchCommentaryEntry.TimeSource.CLOCK and minute is None:
                if match.clock_state == Match.ClockState.NOT_STARTED and int(match.clock_elapsed_seconds or 0) == 0:
                    return Response(
                        {"detail": "Zegar meczu nie jest uruchomiony - podaj minute ręcznie albo uruchom zegar."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                minute = match.clock_minute_total(now=timezone.now())

            period = match.clock_period if match.clock_period else getattr(Match.ClockPeriod, "NONE", "NONE")
            if data.get("period"):
                period = str(data.get("period") or "").strip() or period

            entry = MatchCommentaryEntry.objects.create(
                match=match,
                period=period,
                time_source=time_source,
                minute=minute,
                minute_raw=minute_raw,
                text=text,
                created_by=request.user,
            )

            return Response(_serialize_commentary_entry(entry), status=status.HTTP_201_CREATED)


class MatchCommentaryDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, commentary_id: int):
        with transaction.atomic():
            entry = get_object_or_404(
                MatchCommentaryEntry.objects.select_related("match__tournament").select_for_update(),
                pk=commentary_id,
            )

            try:
                _require_can_manage_commentary(request.user, entry.match.tournament)
            except PermissionError as e:
                return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

            data = request.data or {}
            update_fields: list[str] = []

            if "text" in data:
                text = (data.get("text") or "").strip()
                if not text:
                    return Response({"detail": "text nie może być puste."}, status=status.HTTP_400_BAD_REQUEST)
                entry.text = text
                update_fields.append("text")

            if "time_source" in data:
                ts = (data.get("time_source") or "").strip()
                if ts not in (MatchCommentaryEntry.TimeSource.CLOCK, MatchCommentaryEntry.TimeSource.MANUAL):
                    return Response({"detail": "time_source musi być CLOCK albo MANUAL."}, status=status.HTTP_400_BAD_REQUEST)
                entry.time_source = ts
                update_fields.append("time_source")

            if "minute" in data:
                try:
                    entry.minute = _parse_int(data.get("minute"), "minute", allow_none=True)
                except ValueError as e:
                    return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
                update_fields.append("minute")

            if "minute_raw" in data:
                entry.minute_raw = (data.get("minute_raw") or "").strip() or None
                update_fields.append("minute_raw")

            if "period" in data:
                entry.period = (str(data.get("period") or "").strip() or entry.period)
                update_fields.append("period")

            if update_fields:
                entry.save(update_fields=update_fields)

            return Response(_serialize_commentary_entry(entry))

    def delete(self, request, commentary_id: int):
        with transaction.atomic():
            entry = get_object_or_404(
                MatchCommentaryEntry.objects.select_related("match__tournament").select_for_update(),
                pk=commentary_id,
            )

            try:
                _require_can_manage_commentary(request.user, entry.match.tournament)
            except PermissionError as e:
                return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

            entry.delete()
            return Response({"ok": True})


class TournamentCommentaryPhraseListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)
        try:
            _require_can_manage_commentary(request.user, tournament)
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

        qs = TournamentCommentaryPhrase.objects.filter(tournament=tournament).order_by(
            "kind",
            "category",
            "order",
            "id",
        )
        return Response([_serialize_phrase(x) for x in qs])

    def post(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)
        try:
            _require_can_manage_commentary(request.user, tournament)
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

        data = request.data or {}

        kind = (data.get("kind") or TournamentCommentaryPhrase.Kind.TOKEN).strip()
        if kind not in (TournamentCommentaryPhrase.Kind.TOKEN, TournamentCommentaryPhrase.Kind.TEMPLATE):
            return Response({"detail": "kind musi być TOKEN albo TEMPLATE."}, status=status.HTTP_400_BAD_REQUEST)

        text = (data.get("text") or "").strip()
        if not text:
            return Response({"detail": "Wymagane pole text."}, status=status.HTTP_400_BAD_REQUEST)

        category = (data.get("category") or "").strip() or None

        try:
            order = _parse_int(data.get("order"), "order", allow_none=True)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        is_active = data.get("is_active")
        if is_active is None:
            is_active = True
        is_active = bool(is_active)

        phrase = TournamentCommentaryPhrase.objects.create(
            tournament=tournament,
            kind=kind,
            category=category,
            text=text,
            order=int(order or 0),
            is_active=is_active,
            created_by=request.user,
        )
        return Response(_serialize_phrase(phrase), status=status.HTTP_201_CREATED)


class TournamentCommentaryPhraseDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, phrase_id: int):
        with transaction.atomic():
            phrase = get_object_or_404(TournamentCommentaryPhrase.objects.select_related("tournament").select_for_update(), pk=phrase_id)

            try:
                _require_can_manage_commentary(request.user, phrase.tournament)
            except PermissionError as e:
                return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

            data = request.data or {}
            update_fields: list[str] = []

            if "kind" in data:
                kind = (data.get("kind") or "").strip()
                if kind not in (TournamentCommentaryPhrase.Kind.TOKEN, TournamentCommentaryPhrase.Kind.TEMPLATE):
                    return Response({"detail": "kind musi być TOKEN albo TEMPLATE."}, status=status.HTTP_400_BAD_REQUEST)
                phrase.kind = kind
                update_fields.append("kind")

            if "category" in data:
                phrase.category = (data.get("category") or "").strip() or None
                update_fields.append("category")

            if "text" in data:
                text = (data.get("text") or "").strip()
                if not text:
                    return Response({"detail": "text nie może być puste."}, status=status.HTTP_400_BAD_REQUEST)
                phrase.text = text
                update_fields.append("text")

            if "order" in data:
                try:
                    o = _parse_int(data.get("order"), "order", allow_none=True)
                except ValueError as e:
                    return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
                phrase.order = int(o or 0)
                update_fields.append("order")

            if "is_active" in data:
                phrase.is_active = bool(data.get("is_active"))
                update_fields.append("is_active")

            if update_fields:
                phrase.save(update_fields=update_fields)

            return Response(_serialize_phrase(phrase))

    def delete(self, request, phrase_id: int):
        with transaction.atomic():
            phrase = get_object_or_404(TournamentCommentaryPhrase.objects.select_related("tournament").select_for_update(), pk=phrase_id)

            try:
                _require_can_manage_commentary(request.user, phrase.tournament)
            except PermissionError as e:
                return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

            phrase.delete()
            return Response({"ok": True})
