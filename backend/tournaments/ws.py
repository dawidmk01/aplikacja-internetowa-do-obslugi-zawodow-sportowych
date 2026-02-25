from __future__ import annotations

# Kontrakt: nazwy grup Channels muszą być ASCII i mieć < 100 znaków.


def tournament_group_name(tournament_id: int) -> str:
    # Uwaga: nie używamy ':' - jest niedozwolony w nazwie grupy.
    return f"tournament.{int(tournament_id)}"


def user_group_name(user_id: int) -> str:
    return f"user.{int(user_id)}"


# Alias wstecznej kompatybilności - starsze importy używały me_group_name.
def me_group_name(user_id: int) -> str:
    return user_group_name(user_id)
