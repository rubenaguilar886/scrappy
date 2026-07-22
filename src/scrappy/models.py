from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

# Estado del proceso de enriquecimiento de contacto
EnrichmentStatus = Literal[
    "pendiente",          # aún no procesado
    "encontrado",         # web / teléfono localizado
    "sin_contacto",       # búsqueda hecha pero sin resultado
    "activo_sunat",       # validado como ACTIVO+HABIDO en SUNAT
    "inactivo_sunat",     # baja o no habido según SUNAT
]


class Business(BaseModel):
    """Representa un negocio encontrado por cualquier scraper."""

    # ── Campos comunes ──────────────────────────────────────
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    email: Optional[str] = None
    rating: Optional[float] = None
    reviews_count: Optional[int] = None
    category: Optional[str] = None
    hours: Optional[str] = None
    google_maps_url: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    source: str = "google_maps"
    search_query: Optional[str] = None
    scraped_at: datetime = Field(default_factory=datetime.now)

    # ── Campos exclusivos de PRODUCE/CIIU ───────────────────
    ruc: Optional[str] = None
    ciiu_code: Optional[str] = None          # ej: "7310"
    ciiu_desc: Optional[str] = None          # ej: "PUBLICIDAD"
    departamento: Optional[str] = None
    provincia: Optional[str] = None
    distrito: Optional[str] = None
    ubigeo: Optional[str] = None
    sector: Optional[str] = None             # ej: "SERVICIO"
    periodo: Optional[str] = None            # año del padrón (ej: "2021")

    # ── Enriquecimiento de contacto ─────────────────────────
    enrichment_status: EnrichmentStatus = "pendiente"
    enrichment_source: Optional[str] = None  # URL donde se encontró el dato
    sunat_estado: Optional[str] = None       # "ACTIVO" / "BAJA" / None
    sunat_condicion: Optional[str] = None    # "HABIDO" / "NO HABIDO" / None

    def to_sheet_row(self) -> dict:
        """Formato plano para exportar a Google Sheets."""
        return {
            "Nombre": self.name,
            "RUC": self.ruc or "",
            "CIIU": self.ciiu_code or "",
            "Categoría CIIU": self.ciiu_desc or "",
            "Sector": self.sector or "",
            "Departamento": self.departamento or "",
            "Provincia": self.provincia or "",
            "Distrito": self.distrito or "",
            "Dirección": self.address or "",
            "Teléfono": self.phone or "",
            "Sitio Web": self.website or "",
            "Email": self.email or "",
            "Estado Enriquecimiento": self.enrichment_status,
            "Fuente Enriquecimiento": self.enrichment_source or "",
            "SUNAT Estado": self.sunat_estado or "",
            "SUNAT Condición": self.sunat_condicion or "",
            "Calificación": self.rating or "",
            "Reseñas": self.reviews_count or "",
            "URL Google Maps": self.google_maps_url or "",
            "Fuente": self.source,
            "Período": self.periodo or "",
            "Fecha Scraping": self.scraped_at.strftime("%Y-%m-%d %H:%M"),
        }
