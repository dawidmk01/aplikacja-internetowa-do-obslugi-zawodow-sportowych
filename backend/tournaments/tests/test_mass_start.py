# backend/tournaments/tests/test_mass_start.py
# Plik zabezpiecza strukturę etapów, grup, wpisów i wyników modelu MASS_START.

from .helpers import *


class TournamentMassStartStructureTests(TestCase):
    """Testy zabezpieczają strukturę etapów i wyników modelu MASS_START."""

    def setUp(self):
        self.organizer = create_test_user("mass-start-owner@example.com")

    def _stage_model(self):
        return apps.get_model("tournaments", "Stage")

    def _group_model(self):
        return apps.get_model("tournaments", "Group")

    def _entry_model(self):
        return apps.get_model("tournaments", "StageMassStartEntry")

    def _result_model(self):
        return apps.get_model("tournaments", "StageMassStartResult")

    def _match_model(self):
        return apps.get_model("tournaments", "Match")

    def _result_config(
        self,
        *,
        value_kind=None,
        better_result=None,
        rounds_count=1,
        stages=None,
        decimal_places=0,
        stage_structure_mode=None,
    ):
        value_kind = value_kind or Tournament.RESULTCFG_VALUE_KIND_NUMBER
        better_result = better_result or Tournament.RESULTCFG_BETTER_RESULT_HIGHER

        return {
            Tournament.RESULTCFG_CUSTOM_MODE_KEY: Tournament.RESULTCFG_CUSTOM_MODE_MASS_START_MEASURED,
            Tournament.RESULTCFG_VALUE_KIND_KEY: value_kind,
            Tournament.RESULTCFG_BETTER_RESULT_KEY: better_result,
            Tournament.RESULTCFG_DECIMAL_PLACES_KEY: decimal_places,
            Tournament.RESULTCFG_ROUNDS_COUNT_KEY: rounds_count,
            Tournament.RESULTCFG_STAGE_STRUCTURE_MODE_KEY: stage_structure_mode or Tournament.RESULTCFG_STAGE_STRUCTURE_REDUCTION,
            Tournament.RESULTCFG_STAGES_KEY: stages
            or [
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Finał",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: rounds_count,
                }
            ],
        }

    def _create_mass_start_context(
        self,
        *,
        name="Turniej MASS_START",
        teams_count=4,
        result_config=None,
    ):
        tournament = Tournament.objects.create(
            name=name,
            discipline=Tournament.Discipline.CUSTOM,
            custom_discipline_name="Test wspólnego startu",
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.INDIVIDUAL,
            competition_model=Tournament.CompetitionModel.MASS_START,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.CUSTOM,
            result_config=result_config or self._result_config(),
        )

        division = Division.objects.create(
            tournament=tournament,
            name="Dywizja MASS_START",
            is_default=True,
            competition_type=Tournament.CompetitionType.INDIVIDUAL,
            competition_model=Tournament.CompetitionModel.MASS_START,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.CUSTOM,
            result_config=result_config or self._result_config(),
            status=Tournament.Status.CONFIGURED,
        )

        teams = [
            Team.objects.create(
                tournament=tournament,
                division=division,
                name=f"Zawodnik {index}",
                is_active=True,
            )
            for index in range(1, teams_count + 1)
        ]

        return tournament, division, teams

    def test_sync_mass_start_structure_creates_stage_group_and_entries(self):
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        stage_model = self._stage_model()
        group_model = self._group_model()
        entry_model = self._entry_model()

        tournament, division, teams = self._create_mass_start_context()

        sync_custom_mass_start_structure_for_division(tournament, division)

        stages = stage_model.objects.filter(
            tournament=tournament,
            division=division,
            stage_type=stage_model.StageType.MASS_START,
        )
        groups = group_model.objects.filter(stage__in=stages)
        entries = entry_model.objects.filter(stage__in=stages, is_active=True)

        self.assertEqual(stages.count(), 1)
        self.assertEqual(stages.first().status, stage_model.Status.OPEN)
        self.assertEqual(groups.count(), 1)
        self.assertEqual(entries.count(), len(teams))
        self.assertEqual(
            list(entries.order_by("seed").values_list("team_id", flat=True)),
            [team.id for team in teams],
        )

    def test_sync_mass_start_structure_distributes_entries_between_groups(self):
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        group_model = self._group_model()
        entry_model = self._entry_model()

        result_config = self._result_config(
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Kwalifikacje",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 2,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                }
            ]
        )
        tournament, division, _teams = self._create_mass_start_context(
            name="Turniej MASS_START grupy",
            teams_count=5,
            result_config=result_config,
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        groups = list(group_model.objects.filter(stage__division=division).order_by("id"))
        group_sizes = [
            entry_model.objects.filter(stage__division=division, group=group, is_active=True).count()
            for group in groups
        ]

        self.assertEqual(len(groups), 2)
        self.assertEqual(group_sizes, [3, 2])

    def test_sync_mass_start_structure_respects_stage_participants_limit(self):
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        entry_model = self._entry_model()

        result_config = self._result_config(
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Limitowany etap",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_PARTICIPANTS_COUNT_KEY: 3,
                }
            ]
        )
        tournament, division, teams = self._create_mass_start_context(
            name="Turniej MASS_START limit",
            teams_count=5,
            result_config=result_config,
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        entries = entry_model.objects.filter(stage__division=division, is_active=True).order_by("seed")

        self.assertEqual(entries.count(), 3)
        self.assertEqual(
            list(entries.values_list("team_id", flat=True)),
            [team.id for team in teams[:3]],
        )

    def test_sync_mass_start_structure_creates_multiple_stages(self):
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        stage_model = self._stage_model()

        result_config = self._result_config(
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Kwalifikacje",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 2,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Finał",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
            ]
        )
        tournament, division, _teams = self._create_mass_start_context(
            name="Turniej MASS_START dwa etapy",
            result_config=result_config,
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        stages = list(stage_model.objects.filter(tournament=tournament, division=division).order_by("order"))

        self.assertEqual(len(stages), 2)
        self.assertEqual(stages[0].status, stage_model.Status.OPEN)
        self.assertEqual(stages[1].status, stage_model.Status.PLANNED)

    def test_sync_mass_start_structure_removes_stale_non_mass_start_stages_in_division(self):
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        stage_model = self._stage_model()
        match_model = self._match_model()

        tournament, division, teams = self._create_mass_start_context()

        stale_stage = stage_model.objects.create(
            tournament=tournament,
            division=division,
            stage_type=stage_model.StageType.LEAGUE,
            order=99,
        )
        match_model.objects.create(
            tournament=tournament,
            stage=stale_stage,
            home_team=teams[0],
            away_team=teams[1],
            round_number=1,
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        self.assertFalse(stage_model.objects.filter(id=stale_stage.id).exists())
        self.assertFalse(match_model.objects.filter(stage=stale_stage).exists())
        self.assertTrue(
            stage_model.objects.filter(
                tournament=tournament,
                division=division,
                stage_type=stage_model.StageType.MASS_START,
            ).exists()
        )

    def test_sync_multi_event_structure_creates_parallel_competitions(self):
        from tournaments.views.tournaments import (
            _stage_name_for_mass_start,
            sync_custom_mass_start_structure_for_division,
        )

        stage_model = self._stage_model()
        entry_model = self._entry_model()

        result_config = self._result_config(
            stage_structure_mode=Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT,
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Przysiad",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_PARTICIPANTS_COUNT_KEY: 2,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Wyciskanie leżąc",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_PARTICIPANTS_COUNT_KEY: 3,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Martwy ciąg",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_PARTICIPANTS_COUNT_KEY: 4,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
            ],
        )
        tournament, division, teams = self._create_mass_start_context(
            name="Turniej MASS_START wielobój",
            teams_count=4,
            result_config=result_config,
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        stages = list(
            stage_model.objects.filter(tournament=tournament, division=division).order_by("order")
        )

        stage_cfgs = list(division.get_mass_start_stages() or [])
        stage_names = [
            _stage_name_for_mass_start(
                stage.order,
                stage_cfgs[stage.order - 1],
                Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT,
            )
            for stage in stages
        ]

        self.assertEqual(stage_names, ["Przysiad", "Wyciskanie leżąc", "Martwy ciąg"])
        self.assertEqual([stage.status for stage in stages], [stage_model.Status.OPEN, stage_model.Status.OPEN, stage_model.Status.OPEN])

        for stage in stages:
            entries = entry_model.objects.filter(stage=stage, is_active=True)
            self.assertEqual(entries.count(), len(teams))
            self.assertEqual(
                set(entries.values_list("team_id", flat=True)),
                {team.id for team in teams},
            )

    def test_sync_multi_event_structure_uses_competition_default_names(self):
        from tournaments.views.tournaments import (
            _stage_name_for_mass_start,
            sync_custom_mass_start_structure_for_division,
        )

        stage_model = self._stage_model()

        result_config = self._result_config(
            stage_structure_mode=Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT,
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
                {
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
            ],
        )
        tournament, division, _teams = self._create_mass_start_context(
            name="Turniej MASS_START nazwy konkurencji",
            result_config=result_config,
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        stages = list(
            stage_model.objects.filter(tournament=tournament, division=division).order_by("order")
        )

        stage_cfgs = list(division.get_mass_start_stages() or [])
        stage_names = [
            _stage_name_for_mass_start(
                stage.order,
                stage_cfgs[stage.order - 1],
                Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT,
            )
            for stage in stages
        ]

        self.assertEqual(stage_names, ["Konkurencja 1", "Konkurencja 2"])

    def test_stage_mass_start_result_accepts_numeric_value_for_stage_entry(self):
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        result_model = self._result_model()

        tournament, division, teams = self._create_mass_start_context(
            result_config=self._result_config(decimal_places=2)
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        stage = self._stage_model().objects.get(tournament=tournament, division=division)
        group = self._group_model().objects.get(stage=stage)

        result = result_model.objects.create(
            stage=stage,
            group=group,
            team=teams[0],
            round_number=1,
            value_kind=Tournament.RESULTCFG_VALUE_KIND_NUMBER,
            numeric_value="12.345",
            display_value="12.35",
            created_by=self.organizer,
            updated_by=self.organizer,
        )

        self.assertEqual(result.stage_id, stage.id)
        self.assertEqual(result.group_id, group.id)
        self.assertEqual(result.team_id, teams[0].id)
        self.assertEqual(str(result.numeric_value), "12.34")

    def test_stage_mass_start_result_accepts_non_start_status_without_value(self):
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        result_model = self._result_model()

        tournament, division, teams = self._create_mass_start_context()

        sync_custom_mass_start_structure_for_division(tournament, division)

        stage = self._stage_model().objects.get(tournament=tournament, division=division)
        group = self._group_model().objects.get(stage=stage)

        result = result_model.objects.create(
            stage=stage,
            group=group,
            team=teams[0],
            round_number=1,
            value_kind=Tournament.RESULTCFG_VALUE_KIND_NUMBER,
            result_status=result_model.ResultStatus.DNF,
            created_by=self.organizer,
            updated_by=self.organizer,
        )

        self.assertEqual(result.result_status, result_model.ResultStatus.DNF)
        self.assertIsNone(result.numeric_value)
        self.assertIsNone(result.time_ms)
        self.assertIsNone(result.place_value)
        self.assertEqual(result.display_value, "DNF")
        self.assertIsNone(result.rank)

    def test_stage_mass_start_result_rejects_team_without_stage_entry(self):
        from django.core.exceptions import ValidationError
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        result_model = self._result_model()

        tournament, division, _teams = self._create_mass_start_context(teams_count=2)

        sync_custom_mass_start_structure_for_division(tournament, division)

        foreign_team = Team.objects.create(
            tournament=tournament,
            division=division,
            name="Zawodnik bez wpisu",
            is_active=True,
        )

        stage = self._stage_model().objects.get(tournament=tournament, division=division)
        group = self._group_model().objects.get(stage=stage)

        result = result_model(
            stage=stage,
            group=group,
            team=foreign_team,
            round_number=1,
            value_kind=Tournament.RESULTCFG_VALUE_KIND_NUMBER,
            numeric_value="10",
        )

        with self.assertRaises(ValidationError):
            result.save()

    def test_stage_mass_start_result_rejects_wrong_value_kind(self):
        from django.core.exceptions import ValidationError
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        result_model = self._result_model()

        tournament, division, teams = self._create_mass_start_context(
            result_config=self._result_config(value_kind=Tournament.RESULTCFG_VALUE_KIND_TIME)
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        stage = self._stage_model().objects.get(tournament=tournament, division=division)
        group = self._group_model().objects.get(stage=stage)

        result = result_model(
            stage=stage,
            group=group,
            team=teams[0],
            round_number=1,
            value_kind=Tournament.RESULTCFG_VALUE_KIND_NUMBER,
            numeric_value="10",
        )

        with self.assertRaises(ValidationError):
            result.save()

    def test_stage_mass_start_result_accepts_time_value_when_configured(self):
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        result_model = self._result_model()

        tournament, division, teams = self._create_mass_start_context(
            name="Turniej MASS_START czas",
            result_config=self._result_config(value_kind=Tournament.RESULTCFG_VALUE_KIND_TIME),
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        stage = self._stage_model().objects.get(tournament=tournament, division=division)
        group = self._group_model().objects.get(stage=stage)

        result = result_model.objects.create(
            stage=stage,
            group=group,
            team=teams[0],
            round_number=1,
            value_kind=Tournament.RESULTCFG_VALUE_KIND_TIME,
            time_ms=12345,
            display_value="12.34",
            created_by=self.organizer,
            updated_by=self.organizer,
        )

        self.assertEqual(result.time_ms, 12345)
        self.assertIsNone(result.numeric_value)
        self.assertIsNone(result.place_value)

    def test_stage_mass_start_result_rejects_group_outside_entry_assignment(self):
        from django.core.exceptions import ValidationError
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        result_model = self._result_model()

        result_config = self._result_config(
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Grupy",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 2,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                }
            ]
        )
        tournament, division, teams = self._create_mass_start_context(
            name="Turniej MASS_START błędna grupa",
            teams_count=4,
            result_config=result_config,
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        stage = self._stage_model().objects.get(tournament=tournament, division=division)
        groups = list(self._group_model().objects.filter(stage=stage).order_by("id"))
        first_entry = self._entry_model().objects.get(stage=stage, team=teams[0])

        wrong_group = groups[1] if first_entry.group_id == groups[0].id else groups[0]

        result = result_model(
            stage=stage,
            group=wrong_group,
            team=teams[0],
            round_number=1,
            value_kind=Tournament.RESULTCFG_VALUE_KIND_NUMBER,
            numeric_value="10",
        )

        with self.assertRaises(ValidationError):
            result.save()


    def test_sync_multi_event_structure_archives_removed_competition(self):
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        stage_model = self._stage_model()
        result_model = self._result_model()

        stages_cfg = [
            {
                Tournament.RESULTCFG_STAGE_NAME_KEY: f"Konkurencja {index}",
                Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
            }
            for index in range(1, 5)
        ]
        result_config = self._result_config(
            stage_structure_mode=Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT,
            decimal_places=2,
            stages=stages_cfg,
        )
        tournament, division, teams = self._create_mass_start_context(
            name="Turniej MULTI_EVENT archiwum",
            result_config=result_config,
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        stage_four = stage_model.objects.get(tournament=tournament, division=division, order=4)
        group = self._group_model().objects.get(stage=stage_four)
        stage_four.scheduled_date = "2026-01-10"
        stage_four.location = "Sala A"
        stage_four.save(update_fields=["scheduled_date", "location"])

        result_model.objects.create(
            stage=stage_four,
            group=group,
            team=teams[0],
            round_number=1,
            value_kind=Tournament.RESULTCFG_VALUE_KIND_NUMBER,
            numeric_value="120",
            display_value="120.00",
            created_by=self.organizer,
            updated_by=self.organizer,
        )

        reduced_config = self._result_config(
            stage_structure_mode=Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT,
            decimal_places=2,
            stages=stages_cfg[:3],
        )
        division.result_config = reduced_config
        division.save(update_fields=["result_config"])

        sync_custom_mass_start_structure_for_division(tournament, division)

        stage_four.refresh_from_db()
        self.assertTrue(stage_four.is_archived)
        self.assertEqual(stage_four.archive_reason, "MASS_START_STRUCTURE_REDUCED")
        self.assertEqual(
            stage_model.objects.filter(tournament=tournament, division=division, is_archived=False).count(),
            3,
        )
        self.assertTrue(result_model.objects.filter(stage=stage_four, team=teams[0]).exists())

    def test_sync_multi_event_structure_can_restore_archived_competition(self):
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        stage_model = self._stage_model()
        result_model = self._result_model()

        stages_cfg = [
            {
                Tournament.RESULTCFG_STAGE_NAME_KEY: f"Konkurencja {index}",
                Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
            }
            for index in range(1, 5)
        ]
        result_config = self._result_config(
            stage_structure_mode=Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT,
            decimal_places=2,
            stages=stages_cfg,
        )
        tournament, division, teams = self._create_mass_start_context(
            name="Turniej MULTI_EVENT przywracanie",
            result_config=result_config,
        )

        sync_custom_mass_start_structure_for_division(tournament, division)
        stage_four = stage_model.objects.get(tournament=tournament, division=division, order=4)
        original_stage_id = stage_four.id
        group = self._group_model().objects.get(stage=stage_four)

        result_model.objects.create(
            stage=stage_four,
            group=group,
            team=teams[0],
            round_number=1,
            value_kind=Tournament.RESULTCFG_VALUE_KIND_NUMBER,
            numeric_value="120",
            display_value="120.00",
            created_by=self.organizer,
            updated_by=self.organizer,
        )

        division.result_config = self._result_config(
            stage_structure_mode=Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT,
            decimal_places=2,
            stages=stages_cfg[:3],
        )
        division.save(update_fields=["result_config"])
        sync_custom_mass_start_structure_for_division(tournament, division)

        division.result_config = result_config
        division.save(update_fields=["result_config"])
        sync_custom_mass_start_structure_for_division(
            tournament,
            division,
            restore_archived_mass_start=True,
        )

        restored_stage = stage_model.objects.get(pk=original_stage_id)
        self.assertFalse(restored_stage.is_archived)
        self.assertTrue(result_model.objects.filter(stage=restored_stage, team=teams[0]).exists())
        self.assertEqual(
            stage_model.objects.filter(tournament=tournament, division=division, is_archived=False).count(),
            4,
        )
