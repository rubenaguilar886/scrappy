"""
Scraper para el Directorio de Empresas MIPYME de PRODUCE
(datosabiertos.gob.pe — CSV de ~2M filas).

Coloca el CSV descargado en:
    data/produce_mipyme.csv          ← ruta por defecto
o pasa la ruta con --csv-path.

Columnas esperadas (sin importar mayúsculas):
    ruc, razon_social, descripcion_ciiu3, ciiu3,
    departamento, provincia, distrito, ubigeo,
    sector, PERIODO, FECHA_PUBLICACION
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import List, Optional

from scrappy.models import Business
from scrappy.scrapers.base import BaseScraper

# Ruta por defecto al CSV
DEFAULT_CSV = Path("data") / "produce_mipyme.csv"


class ProduceDirectoryScraper(BaseScraper):
    """
    Lee el CSV de PRODUCE y filtra por CIIU + departamento
    sin necesidad de navegador ni conexión a internet.

    Uso:
        scraper = ProduceDirectoryScraper()
        businesses = await scraper.search(
            ciiu_codes=["7310", "7830"],
            departamento="LIMA",
            max_results=100,
        )
    """

    source_name = "produce_directory"

    def __init__(self, csv_path: Path | str = DEFAULT_CSV):
        self.csv_path = Path(csv_path)

    # ── Interfaz BaseScraper (firma genérica, no se usa directamente) ──
    async def search(
        self,
        query: str = "",
        location: str = "",
        max_results: int = 50,
    ) -> List[Business]:
        """
        Interfaz genérica — usa search_by_ciiu() para control completo.
        query  → se ignora (usa ciiu_codes de search_by_ciiu)
        location → si se pasa, se interpreta como departamento
        """
        return await self.search_by_ciiu(
            ciiu_codes=[],
            departamento=location.upper() if location else "LIMA",
            max_results=max_results,
        )

    # ── API principal ────────────────────────────────────────────────────
    async def search_by_ciiu(
        self,
        ciiu_codes: List[str],
        departamento: str = "LIMA",
        provincia: Optional[str] = None,
        distrito: Optional[str] = None,
        sector: Optional[str] = None,
        max_results: int = 500,
    ) -> List[Business]:
        """
        Filtra el directorio PRODUCE y devuelve objetos Business.

        Args:
            ciiu_codes:   Lista de códigos CIIU-3 a incluir. Vacío = todos.
            departamento: Filtro de departamento (en mayúsculas, ej: "LIMA").
            provincia:    Filtro opcional de provincia.
            distrito:     Filtro opcional de distrito.
            sector:       Filtro opcional de sector (ej: "SERVICIO", "INDUSTRIA").
            max_results:  Máximo de resultados a devolver.

        Returns:
            Lista de Business con enrichment_status="pendiente" (sin phone/website aún).
        """
        if not self.csv_path.exists():
            raise FileNotFoundError(
                f"CSV de PRODUCE no encontrado en: {self.csv_path.resolve()}\n"
                f"Descárgalo de https://www.datosabiertos.gob.pe y colócalo ahí."
            )

        # Normalizar filtros a mayúsculas
        ciiu_set = {c.strip() for c in ciiu_codes} if ciiu_codes else set()
        dep_norm = departamento.strip().upper()
        prov_norm = provincia.strip().upper() if provincia else None
        dist_norm = distrito.strip().upper() if distrito else None
        sec_norm = sector.strip().upper() if sector else None

        businesses: List[Business] = []

        with open(self.csv_path, encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)

            # Normalizar nombres de columnas (quitar espacios, lower)
            if reader.fieldnames is None:
                raise ValueError("CSV sin encabezados")

            col = {h.strip().lower(): h for h in reader.fieldnames}

            def get(row: dict, key: str, default: str = "") -> str:
                mapped = col.get(key, key)
                return (row.get(mapped) or "").strip().upper()

            def get_raw(row: dict, key: str) -> str:
                mapped = col.get(key, key)
                return (row.get(mapped) or "").strip()

            for row in reader:
                # ── Filtros ──────────────────────────────────────────────
                if get(row, "departamento") != dep_norm:
                    continue
                if prov_norm and get(row, "provincia") != prov_norm:
                    continue
                if dist_norm and get(row, "distrito") != dist_norm:
                    continue
                if sec_norm and get(row, "sector") != sec_norm:
                    continue

                ciiu = get_raw(row, "ciiu3")
                if ciiu_set and ciiu not in ciiu_set:
                    continue

                # ── Construir Business ────────────────────────────────────
                razon = get_raw(row, "razon_social")
                if not razon:
                    continue

                b = Business(
                    name=razon,
                    ruc=get_raw(row, "ruc") or None,
                    ciiu_code=ciiu or None,
                    ciiu_desc=get_raw(row, "descripcion_ciiu3") or None,
                    departamento=get_raw(row, "departamento") or None,
                    provincia=get_raw(row, "provincia") or None,
                    distrito=get_raw(row, "distrito") or None,
                    ubigeo=get_raw(row, "ubigeo") or None,
                    sector=get_raw(row, "sector") or None,
                    periodo=get_raw(row, "periodo") or get_raw(row, "fecha_publicacion") or None,
                    category=get_raw(row, "descripcion_ciiu3") or None,
                    source=self.source_name,
                    search_query=f"CIIU:{','.join(sorted(ciiu_set)) or '*'} DEP:{dep_norm}",
                    enrichment_status="pendiente",
                )
                businesses.append(b)

                if len(businesses) >= max_results:
                    break

        return businesses
