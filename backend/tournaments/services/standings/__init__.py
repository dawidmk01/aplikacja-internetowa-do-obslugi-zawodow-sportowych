# backend/tournaments/services/standings/__init__.py
# Plik udostępnia publiczny eksport głównej funkcji obliczania klasyfikacji etapu.

from .compute import compute_stage_standings

__all__ = ["compute_stage_standings"]
