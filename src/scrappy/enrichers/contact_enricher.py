"""
Enriquecimiento de contacto para leads de PRODUCE.

Por cada Business sin teléfono ni web, busca en Google:
    "<razon_social> contacto Peru"
y extrae el primer resultado con website, teléfono o WhatsApp.

Si no encuentra nada → enrichment_status = "sin_contacto".
"""

from __future__ import annotations

import asyncio
import re
from typing import List, Optional
from urllib.parse import quote

from playwright.async_api import Browser, BrowserContext, Page, async_playwright
from rich.console import Console
from rich.progress import BarColumn, Progress, SpinnerColumn, TaskProgressColumn, TextColumn

from scrappy.models import Business

console = Console()

# Patrones de extracción
_RE_PHONE = re.compile(
    r"(?:\+51|51)?[\s\-]?(?:9\d{8}|(?:01|0[2-9]\d)[\s\-]?\d{6,7})"
)
_RE_WA = re.compile(r"wa\.me/(?:51)?(\d{9})", re.I)
_RE_EMAIL = re.compile(r"[\w.+-]+@[\w.-]+\.[a-z]{2,}", re.I)
_RE_URL = re.compile(r"https?://[\w\-./]+", re.I)


class ContactEnricher:
    """
    Enriquece una lista de Business (tipicamente de ProduceDirectoryScraper)
    buscando contacto en Google para cada empresa.

    Uso:
        enricher = ContactEnricher(headless=True, concurrency=3)
        enriched = await enricher.enrich(businesses)
    """

    def __init__(
        self,
        headless: bool = True,
        concurrency: int = 3,
        delay_ms: int = 1800,
        skip_already_enriched: bool = True,
    ):
        self.headless = headless
        self.concurrency = concurrency
        self.delay_ms = delay_ms
        self.skip_already_enriched = skip_already_enriched

    async def enrich(self, businesses: List[Business]) -> List[Business]:
        """
        Enriquece in-place la lista y la devuelve.
        Las empresas con phone/website ya presentes se omiten si
        skip_already_enriched=True.
        """
        to_process = [
            b for b in businesses
            if not (self.skip_already_enriched and (b.phone or b.website))
        ]

        if not to_process:
            console.print("[dim]Nada que enriquecer — todos los leads ya tienen contacto.[/dim]")
            return businesses

        console.print(
            f"[bold cyan]🔍 Enriqueciendo {len(to_process)} leads "
            f"(concurrencia={self.concurrency})...[/bold cyan]"
        )

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=self.headless,
                args=["--disable-blink-features=AutomationControlled"],
            )
            # Semáforo para controlar concurrencia
            sem = asyncio.Semaphore(self.concurrency)

            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                BarColumn(),
                TaskProgressColumn(),
                console=console,
            ) as progress:
                task_id = progress.add_task("Enriqueciendo...", total=len(to_process))

                async def process_one(b: Business) -> None:
                    async with sem:
                        context = await browser.new_context(
                            locale="es-PE",
                            user_agent=(
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                                "AppleWebKit/537.36 (KHTML, like Gecko) "
                                "Chrome/120.0.0.0 Safari/537.36"
                            ),
                        )
                        page = await context.new_page()
                        try:
                            await self._enrich_one(page, b)
                        finally:
                            await context.close()
                            progress.advance(task_id)
                        await asyncio.sleep(self.delay_ms / 1000)

                await asyncio.gather(*[process_one(b) for b in to_process])
            await browser.close()

        found = sum(1 for b in to_process if b.enrichment_status == "encontrado")
        console.print(
            f"[green]✓ Enriquecimiento completo:[/green] "
            f"{found}/{len(to_process)} con contacto encontrado"
        )
        return businesses

    # ── Interno ─────────────────────────────────────────────────────────

    async def _enrich_one(self, page: Page, b: Business) -> None:
        """Busca el contacto de UNA empresa en Google."""
        query = f'{b.name} contacto Peru'
        if b.ruc:
            query = f'{b.name} RUC {b.ruc} contacto'

        url = f"https://www.google.com/search?q={quote(query)}&hl=es&gl=PE&num=5"

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=25000)
            await page.wait_for_timeout(1200)

            html = await page.content()

            # 1. WhatsApp link
            wa = _RE_WA.search(html)
            if wa:
                b.phone = f"+51{wa.group(1)}"
                b.enrichment_status = "encontrado"
                b.enrichment_source = url
                return

            # 2. Teléfono peruano
            phone = _RE_PHONE.search(html)
            if phone:
                b.phone = phone.group(0).strip()
                b.enrichment_status = "encontrado"
                b.enrichment_source = url
                # Intentar también capturar website del mismo resultado
                b.website = b.website or await self._extract_website(page)
                return

            # 3. Website — primer resultado orgánico que no sea Google/Wikipedia
            website = await self._extract_website(page)
            if website:
                b.website = website
                b.enrichment_status = "encontrado"
                b.enrichment_source = url
                return

            # 4. Email
            email = _RE_EMAIL.search(html)
            if email:
                b.email = email.group(0)
                b.enrichment_status = "encontrado"
                b.enrichment_source = url
                return

            # No se encontró nada
            b.enrichment_status = "sin_contacto"

        except Exception as exc:
            # Timeout u otros errores — marcamos sin_contacto para no perder el lead
            b.enrichment_status = "sin_contacto"
            b.enrichment_source = f"error: {exc!s:.80}"

    async def _extract_website(self, page: Page) -> Optional[str]:
        """
        Intenta extraer el primer website orgánico de los resultados de Google.
        Excluye dominios propios de Google, Wikipedia, redes sociales.
        """
        SKIP = {
            "google.", "youtube.", "facebook.", "instagram.", "wikipedia.",
            "twitter.", "linkedin.", "tiktok.", "maps.google", "support.google",
        }
        try:
            # Los resultados orgánicos de Google tienen <cite> con la URL visible
            cites = await page.locator("cite").all_inner_texts()
            for cite in cites:
                cite = cite.strip()
                if not cite:
                    continue
                if any(s in cite.lower() for s in SKIP):
                    continue
                # Agregar esquema si falta
                if not cite.startswith("http"):
                    cite = "https://" + cite
                return cite.split(" ")[0]  # quitar rutas extras de texto
        except Exception:
            pass
        return None
