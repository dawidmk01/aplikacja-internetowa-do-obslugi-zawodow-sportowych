# backend/tournaments/views/commentary.py
# Plik obsługuje odczyt, tworzenie, edycję i usuwanie komentarzy live z payloadem realtime rozszerzonym o dywizję.

from __future__ import annotations

from django.db import transaction
from django.db.models import Case, F, IntegerField, Value, When
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.access import can_edit_results
from tournaments.models import Match, MatchCommentaryEntry, Tournament, TournamentCommentaryPhrase

from ..realtime import ws_emit_tournament
from ._helpers import public_access_or_403


def _division_id_from_match(match: Match):
    return getattr(match.stage, "division_id", None)


def _require_can_manage_commentary(user, tournament: Tournament) -> None:
    if can_edit_results(user, tournament):
        return
    raise PermissionError("Brak uprawnień do relacji live.")


def _parse_int(value, field: str, allow_none: bool = True) -> int | None:
    if value is None or value == "":
        return None if allow_none else 0

    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} musi być liczbą całkowitą.")


def _p(name: str, fallback: str) -> str:
    return getattr(Match.ClockPeriod, name, fallback)


def _allowed_periods_for_match(match: Match) -> set[str]:
    discipline = match.tournament.discipline
    allowed: set[str] = {_p("NONE", "NONE")}

    if discipline == Tournament.Discipline.FOOTBALL:
        allowed.update({_p("FH", "FH"), _p("SH", "SH"), _p("ET1", "ET1"), _p("ET2", "ET2")})
        return allowed

    if discipline == Tournament.Discipline.HANDBALL:
        allowed.update({_p("H1", "H1"), _p("H2", "H2"), _p("ET1", "ET1"), _p("ET2", "ET2")})
        return allowed

    if discipline == Tournament.Discipline.BASKETBALL:
        allowed.update({
            _p("Q1", "Q1"),
            _p("Q2", "Q2"),
            _p("Q3", "Q3"),
            _p("Q4", "Q4"),
            _p("OT1", "OT1"),
            _p("OT2", "OT2"),
            _p("OT3", "OT3"),
            _p("OT4", "OT4"),
        })
        return allowed

    return allowed


def _validate_period_for_match(match: Match, period: str) -> str:
    allowed = _allowed_periods_for_match(match)
    if period not in allowed:
        raise ValueError(f"Nieprawidłowy period. Dozwolone: {sorted(list(allowed))}")
    return period


def _serialize_commentary_entry(entry: MatchCommentaryEntry) -> dict:
    return {
        "id": entry.id,
        "match_id": entry.match_id,
        "division_id": getattr(entry.match.stage, "division_id", None),
        "period": entry.period,
        "time_source": entry.time_source,
        "minute": entry.minute,
        "minute_raw": entry.minute_raw,
        "text": entry.text,
        "created_by": entry.created_by_id,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
    }


def _serialize_phrase(phrase: TournamentCommentaryPhrase) -> dict:
    return {
        "id": phrase.id,
        "tournament_id": phrase.tournament_id,
        "kind": phrase.kind,
        "category": phrase.category,
        "text": phrase.text,
        "order": int(phrase.order or 0),
        "is_active": bool(phrase.is_active),
        "created_by": phrase.created_by_id,
        "created_at": phrase.created_at.isoformat() if phrase.created_at else None,
        "updated_at": phrase.updated_at.isoformat() if phrase.updated_at else None,
    }


def _ws_payload(match: Match) -> dict:
    return {"match_id": match.id, "division_id": _division_id_from_match(match)}


class MatchCommentaryListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [AllowAny()]
        return [IsAuthenticated()]

    def get(self, request, match_id: int):
        match = get_object_or_404(Match.objects.select_related("tournament", "stage"), pk=match_id)

        denied = public_access_or_403(request, match.tournament)
        if denied is not None:
            return denied

        qs = (
            MatchCommentaryEntry.objects.select_related("match__tournament", "match__stage")
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

        return Response([_serialize_commentary_entry(item) for item in qs], status=status.HTTP_200_OK)

    def post(self, request, match_id: int):
        with transaction.atomic():
            match = get_object_or_404(
                Match.objects.select_related("tournament", "stage").select_for_update(),
                pk=match_id,
            )

            try:
                _require_can_manage_commentary(request.user, match.tournament)
            except PermissionError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

            data = request.data or {}

            text = (data.get("text") or "").strip()
            if not text:
                return Response({"detail": "Wymagane pole text."}, status=status.HTTP_400_BAD_REQUEST)

            time_source = (data.get("time_source") or MatchCommentaryEntry.TimeSource.CLOCK).strip()
            if time_source not in (MatchCommentaryEntry.TimeSource.CLOCK, MatchCommentaryEntry.TimeSource.MANUAL):
                return Response({"detail": "time_source musi być CLOCK albo MANUAL."}, status=status.HTTP_400_BAD_REQUEST)

            try:
                minute = _parse_int(data.get("minute"), "minute", allow_none=True)
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

            minute_raw = (data.get("minute_raw") or "").strip() or None

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

            try:
                period = _validate_period_for_match(match, period)
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

            entry = MatchCommentaryEntry.objects.create(
                match=match,
                period=period,
                time_source=time_source,
                minute=minute,
                minute_raw=minute_raw,
                text=text,
                created_by=request.user,
            )

            ws_emit_tournament(match.tournament_id, "commentary_changed", _ws_payload(match))
            return Response(_serialize_commentary_entry(entry), status=status.HTTP_201_CREATED)


class MatchCommentaryDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, commentary_id: int):
        with transaction.atomic():
            entry = get_object_or_404(
                MatchCommentaryEntry.objects.select_related("match__tournament", "match__stage").select_for_update(),
                pk=commentary_id,
            )

            try:
                _require_can_manage_commentary(request.user, entry.match.tournament)
            except PermissionError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

            data = request.data or {}
            update_fields: list[str] = []

            if "text" in data:
                text = (data.get("text") or "").strip()
                if not text:
                    return Response({"detail": "text nie może być puste."}, status=status.HTTP_400_BAD_REQUEST)
                entry.text = text
                update_fields.append("text")

            if "time_source" in data:
                time_source = (data.get("time_source") or "").strip()
                if time_source not in (MatchCommentaryEntry.TimeSource.CLOCK, MatchCommentaryEntry.TimeSource.MANUAL):
                    return Response({"detail": "time_source musi być CLOCK albo MANUAL."}, status=status.HTTP_400_BAD_REQUEST)
                entry.time_source = time_source
                update_fields.append("time_source")

            if "minute" in data:
                try:
                    entry.minute = _parse_int(data.get("minute"), "minute", allow_none=True)
                except ValueError as exc:
                    return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
                update_fields.append("minute")

            if "minute_raw" in data:
                entry.minute_raw = (data.get("minute_raw") or "").strip() or None
                update_fields.append("minute_raw")

            if "period" in data:
                proposed_period = str(data.get("period") or "").strip() or entry.period
                try:
                    entry.period = _validate_period_for_match(entry.match, proposed_period)
                except ValueError as exc:
                    return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
                update_fields.append("period")

            if update_fields:
                entry.save(update_fields=update_fields)
                ws_emit_tournament(entry.match.tournament_id, "commentary_changed", _ws_payload(entry.match))

            return Response(_serialize_commentary_entry(entry), status=status.HTTP_200_OK)

    def delete(self, request, commentary_id: int):
        with transaction.atomic():
            entry = get_object_or_404(
                MatchCommentaryEntry.objects.select_related("match__tournament", "match__stage").select_for_update(),
                pk=commentary_id,
            )

            try:
                _require_can_manage_commentary(request.user, entry.match.tournament)
            except PermissionError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

            match = entry.match
            entry.delete()
            ws_emit_tournament(match.tournament_id, "commentary_changed", _ws_payload(match))

            return Response({"ok": True}, status=status.HTTP_200_OK)


class TournamentCommentaryPhraseListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        try:
            _require_can_manage_commentary(request.user, tournament)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        qs = TournamentCommentaryPhrase.objects.filter(tournament=tournament).order_by(
            "kind",
            "category",
            "order",
            "id",
        )
        return Response([_serialize_phrase(item) for item in qs], status=status.HTTP_200_OK)

    def post(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        try:
            _require_can_manage_commentary(request.user, tournament)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

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
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        is_active = data.get("is_active")
        if is_active is None:
            is_active = True

        phrase = TournamentCommentaryPhrase.objects.create(
            tournament=tournament,
            kind=kind,
            category=category,
            text=text,
            order=int(order or 0),
            is_active=bool(is_active),
            created_by=request.user,
        )

        return Response(_serialize_phrase(phrase), status=status.HTTP_201_CREATED)


class TournamentCommentaryPhraseDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, phrase_id: int):
        with transaction.atomic():
            phrase = get_object_or_404(
                TournamentCommentaryPhrase.objects.select_related("tournament").select_for_update(),
                pk=phrase_id,
            )

            try:
                _require_can_manage_commentary(request.user, phrase.tournament)
            except PermissionError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

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
                    order = _parse_int(data.get("order"), "order", allow_none=True)
                except ValueError as exc:
                    return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
                phrase.order = int(order or 0)
                update_fields.append("order")

            if "is_active" in data:
                phrase.is_active = bool(data.get("is_active"))
                update_fields.append("is_active")

            if update_fields:
                phrase.save(update_fields=update_fields)

            return Response(_serialize_phrase(phrase), status=status.HTTP_200_OK)

    def delete(self, request, phrase_id: int):
        with transaction.atomic():
            phrase = get_object_or_404(
                TournamentCommentaryPhrase.objects.select_related("tournament").select_for_update(),
                pk=phrase_id,
            )

            try:
                _require_can_manage_commentary(request.user, phrase.tournament)
            except PermissionError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

            phrase.delete()
            return Response({"ok": True}, status=status.HTTP_200_OK)
