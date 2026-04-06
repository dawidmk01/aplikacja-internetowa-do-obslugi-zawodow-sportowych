# backend/tournaments/views/divisions.py
# Plik udostępnia operacje tworzenia, edycji i archiwizacji dywizji turnieju.

from __future__ import annotations

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils.text import slugify

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.access import can_edit_tournament_detail
from tournaments.models import Division, Team, Tournament


def _division_payload(division: Division) -> dict:
    return {
        "id": division.id,
        "name": division.name,
        "slug": division.slug,
        "order": division.order,
        "is_default": division.is_default,
        "is_archived": division.is_archived,
        "status": division.status,
    }


def _all_divisions_payload(tournament: Tournament) -> list[dict]:
    return [_division_payload(item) for item in tournament.divisions.all().order_by("order", "id")]


def _get_slot_prefix(competition_type: str | None) -> str:
    if competition_type == Tournament.CompetitionType.INDIVIDUAL:
        return "Zawodnik"
    return "Drużyna"


def _clone_division_config(source: Division | None, tournament: Tournament) -> dict:
    if source is None:
        return {
            "competition_type": tournament.competition_type,
            "competition_model": tournament.competition_model,
            "tournament_format": tournament.tournament_format,
            "format_config": dict(tournament.format_config or {}),
            "result_mode": tournament.result_mode,
            "result_config": dict(tournament.result_config or {}),
        }

    return {
        "competition_type": source.competition_type,
        "competition_model": source.competition_model,
        "tournament_format": source.tournament_format,
        "format_config": dict(source.format_config or {}),
        "result_mode": source.result_mode,
        "result_config": dict(source.result_config or {}),
    }


def _unique_division_slug(tournament: Tournament, name: str) -> str:
    base_slug = slugify(name) or "dywizja"
    slug = base_slug
    index = 2

    while tournament.divisions.filter(slug=slug).exists():
        slug = f"{base_slug}-{index}"
        index += 1

    return slug


def _sync_legacy_tournament_config(tournament: Tournament, division: Division) -> None:
    tournament.competition_type = division.competition_type
    tournament.competition_model = division.competition_model
    tournament.tournament_format = division.tournament_format
    tournament.format_config = dict(division.format_config or {})
    tournament.result_mode = division.result_mode
    tournament.result_config = dict(division.result_config or {})
    tournament.save(
        update_fields=[
            "competition_type",
            "competition_model",
            "tournament_format",
            "format_config",
            "result_mode",
            "result_config",
        ]
    )


class TournamentDivisionListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not can_edit_tournament_detail(request.user, tournament):
            return Response(
                {"detail": "Brak uprawnień do zarządzania dywizjami tego turnieju."},
                status=status.HTTP_403_FORBIDDEN,
            )

        raw_name = str(request.data.get("name") or "").strip()
        if not raw_name:
            return Response(
                {"name": "Podaj nazwę nowej dywizji."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if tournament.divisions.filter(name__iexact=raw_name).exists():
            return Response(
                {"name": "Dywizja o tej nazwie już istnieje w tym turnieju."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        source_division = None
        raw_source_division_id = request.data.get("source_division_id")
        if raw_source_division_id not in (None, ""):
            try:
                source_division_id = int(raw_source_division_id)
            except (TypeError, ValueError):
                return Response(
                    {"source_division_id": "source_division_id musi być liczbą całkowitą."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            source_division = tournament.divisions.filter(pk=source_division_id).first()
            if source_division is None:
                return Response(
                    {"source_division_id": "Wskazana dywizja źródłowa nie należy do tego turnieju."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if source_division is None:
            source_division = tournament.get_default_division()

        next_order = (
            tournament.divisions.order_by("-order", "-id").first().order + 1
            if tournament.divisions.exists()
            else 0
        )

        division = Division.objects.create(
            tournament=tournament,
            name=raw_name,
            slug=_unique_division_slug(tournament, raw_name),
            order=next_order,
            is_default=False,
            is_archived=False,
            status=Tournament.Status.DRAFT,
            **_clone_division_config(source_division, tournament),
        )

        # Nowa dywizja dostaje minimalną obsadę roboczą, aby setup mógł od razu działać.
        slot_prefix = _get_slot_prefix(division.competition_type)
        Team.objects.bulk_create(
            [
                Team(tournament=tournament, division=division, name=f"{slot_prefix} 1", is_active=True),
                Team(tournament=tournament, division=division, name=f"{slot_prefix} 2", is_active=True),
            ]
        )

        return Response(
            {
                "division": _division_payload(division),
                "divisions": _all_divisions_payload(tournament),
            },
            status=status.HTTP_201_CREATED,
        )


class TournamentDivisionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def patch(self, request, pk: int, division_id: int):
        tournament = get_object_or_404(Tournament, pk=pk)
        division = get_object_or_404(tournament.divisions.select_for_update(), pk=division_id)

        if not can_edit_tournament_detail(request.user, tournament):
            return Response(
                {"detail": "Brak uprawnień do zarządzania dywizjami tego turnieju."},
                status=status.HTTP_403_FORBIDDEN,
            )

        fallback_division_id = None
        update_fields: list[str] = []

        if "name" in request.data:
            raw_name = str(request.data.get("name") or "").strip()
            if not raw_name:
                return Response(
                    {"name": "Nazwa dywizji nie może być pusta."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            existing = tournament.divisions.filter(name__iexact=raw_name).exclude(pk=division.pk)
            if existing.exists():
                return Response(
                    {"name": "Dywizja o tej nazwie już istnieje w tym turnieju."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if division.name != raw_name:
                division.name = raw_name
                update_fields.append("name")

        if request.data.get("is_default") is True and not division.is_default:
            tournament.divisions.filter(is_default=True).update(is_default=False)
            division.is_default = True
            update_fields.append("is_default")

        if request.data.get("is_archived") is True and not division.is_archived:
            active_others = tournament.divisions.filter(is_archived=False).exclude(pk=division.pk).order_by("order", "id")
            replacement = active_others.first()
            if replacement is None:
                return Response(
                    {"detail": "Nie można zarchiwizować ostatniej aktywnej dywizji."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if division.is_default:
                tournament.divisions.filter(is_default=True).update(is_default=False)
                replacement.is_default = True
                replacement.save(update_fields=["is_default"])
                _sync_legacy_tournament_config(tournament, replacement)
                fallback_division_id = replacement.id

            division.is_archived = True
            update_fields.append("is_archived")

        if update_fields:
            division.save(update_fields=update_fields)

        return Response(
            {
                "division": _division_payload(division),
                "divisions": _all_divisions_payload(tournament),
                "fallback_division_id": fallback_division_id,
            },
            status=status.HTTP_200_OK,
        )