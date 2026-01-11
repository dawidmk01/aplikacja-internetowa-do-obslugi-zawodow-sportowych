
"""tournaments.services

Ten pakiet grupuje serwisy logiki biznesowej (use-cases) turnieju.

Uwaga: plik jest potrzebny m.in. dlatego, że w views/stages.py występuje import:
    from tournaments.services import advance_from_groups_to_knockout
"""

from .advance_from_groups import advance_from_groups_to_knockout

__all__ = ["advance_from_groups_to_knockout"]
