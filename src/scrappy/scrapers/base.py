from abc import ABC, abstractmethod
from typing import List

from scrappy.models import Business


class BaseScraper(ABC):
    """Interfaz base para todos los scrapers (Google Maps, Páginas Amarillas, etc.)."""

    source_name: str = "unknown"

    @abstractmethod
    async def search(self, query: str, location: str = "", max_results: int = 50) -> List[Business]:
        """Busca negocios según query y ubicación."""
        ...
