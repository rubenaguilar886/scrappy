import asyncio
import re
import urllib.parse
from typing import List, Optional, Set

from playwright.async_api import Browser, Page, async_playwright

from scrappy.models import Business
from scrappy.scrapers.base import BaseScraper


class GoogleMapsScraper(BaseScraper):
    """Scraper de Google Maps usando Playwright."""

    source_name = "google_maps"

    def __init__(self, headless: bool = True, slow_mo: int = 0):
        self.headless = headless
        self.slow_mo = slow_mo

    async def search(
        self,
        query: str,
        location: str = "",
        max_results: int = 50,
    ) -> List[Business]:
        full_query = f"{query} {location}".strip()
        search_url = (
            "https://www.google.com/maps/search/"
            + urllib.parse.quote(full_query)
        )

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=self.headless,
                slow_mo=self.slow_mo,
            )
            context = await browser.new_context(
                locale="es-PE",
                viewport={"width": 1400, "height": 900},
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
            )
            page = await context.new_page()

            try:
                await page.goto(search_url, wait_until="domcontentloaded", timeout=60000)
                await page.wait_for_timeout(3000)

                await self._accept_cookies(page)
                await self._scroll_results(page, max_results)

                place_urls = await self._collect_place_urls(page, max_results)
                businesses: List[Business] = []

                for i, url in enumerate(place_urls[:max_results]):
                    business = await self._scrape_place(page, url, full_query)
                    if business:
                        businesses.append(business)
                    if i < len(place_urls) - 1:
                        await page.wait_for_timeout(1500)

                return businesses
            finally:
                await browser.close()

    async def _accept_cookies(self, page: Page) -> None:
        """Acepta el banner de cookies si aparece."""
        selectors = [
            'button:has-text("Aceptar todo")',
            'button:has-text("Accept all")',
            'button:has-text("Aceptar")',
            'form[action*="consent"] button',
        ]
        for selector in selectors:
            try:
                btn = page.locator(selector).first
                if await btn.is_visible(timeout=2000):
                    await btn.click()
                    await page.wait_for_timeout(1000)
                    return
            except Exception:
                continue

    async def _scroll_results(self, page: Page, max_results: int) -> None:
        """Hace scroll en el panel de resultados para cargar más negocios."""
        feed_selector = 'div[role="feed"]'

        try:
            await page.wait_for_selector(feed_selector, timeout=10000)
        except Exception:
            return

        feed = page.locator(feed_selector)
        previous_count = 0
        stale_rounds = 0

        while stale_rounds < 3:
            items = page.locator(f'{feed_selector} a[href*="/maps/place/"]')
            current_count = await items.count()

            if current_count >= max_results:
                break

            if current_count == previous_count:
                stale_rounds += 1
            else:
                stale_rounds = 0
                previous_count = current_count

            await feed.evaluate("el => el.scrollTop = el.scrollHeight")
            await page.wait_for_timeout(2000)

    async def _collect_place_urls(self, page: Page, max_results: int) -> List[str]:
        """Recopila URLs únicas de los resultados."""
        links = page.locator('a[href*="/maps/place/"]')
        count = await links.count()
        urls: List[str] = []
        seen: Set[str] = set()

        for i in range(count):
            href = await links.nth(i).get_attribute("href")
            if not href or "/maps/place/" not in href:
                continue

            clean_url = href.split("?")[0]
            if clean_url not in seen:
                seen.add(clean_url)
                urls.append(href if href.startswith("http") else f"https://www.google.com{href}")

            if len(urls) >= max_results:
                break

        return urls

    async def _scrape_place(
        self, page: Page, url: str, search_query: str
    ) -> Optional[Business]:
        """Extrae detalles de un negocio individual."""
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(2500)

            name = await self._get_text(page, "h1")
            if not name:
                return None

            address = await self._get_info_by_label(page, "Dirección")
            if not address:
                address = await self._get_info_by_label(page, "Address")

            phone = await self._get_info_by_label(page, "Teléfono")
            if not phone:
                phone = await self._get_info_by_label(page, "Phone")

            website = await self._get_website(page)
            rating, reviews_count = await self._get_rating(page)
            category = await self._get_category(page)
            hours = await self._get_hours(page)
            lat, lng = self._extract_coords(url)

            return Business(
                name=name,
                address=address,
                phone=phone,
                website=website,
                rating=rating,
                reviews_count=reviews_count,
                category=category,
                hours=hours,
                google_maps_url=url.split("?")[0],
                latitude=lat,
                longitude=lng,
                source=self.source_name,
                search_query=search_query,
            )
        except Exception:
            return None

    async def _get_text(self, page: Page, selector: str) -> Optional[str]:
        try:
            el = page.locator(selector).first
            if await el.is_visible(timeout=3000):
                text = await el.inner_text()
                return text.strip() if text else None
        except Exception:
            pass
        return None

    async def _get_info_by_label(self, page: Page, label: str) -> Optional[str]:
        """Busca un valor por su etiqueta (Dirección, Teléfono, etc.)."""
        selectors = [
            f'button[data-item-id="address"]',
            f'button[data-tooltip="{label}"]',
            f'[aria-label*="{label}"]',
        ]

        if label in ("Dirección", "Address"):
            selectors = ['button[data-item-id="address"]', '[data-item-id="address"]'] + selectors
        elif label in ("Teléfono", "Phone"):
            selectors = ['button[data-item-id^="phone"]', '[data-item-id^="phone"]'] + selectors

        for selector in selectors:
            try:
                el = page.locator(selector).first
                if await el.is_visible(timeout=1500):
                    text = await el.get_attribute("aria-label") or await el.inner_text()
                    if text:
                        cleaned = self._clean_label_text(text, label)
                        if cleaned:
                            return cleaned
            except Exception:
                continue
        return None

    def _clean_label_text(self, text: str, label: str) -> str:
        text = text.strip()
        for prefix in [label, label + ":", "Address:", "Phone:", "Dirección:", "Teléfono:"]:
            if text.lower().startswith(prefix.lower()):
                text = text[len(prefix):].strip()
        return text

    async def _get_website(self, page: Page) -> Optional[str]:
        try:
            link = page.locator('a[data-item-id="authority"]').first
            if await link.is_visible(timeout=2000):
                href = await link.get_attribute("href")
                return href
        except Exception:
            pass
        return None

    async def _get_rating(self, page: Page) -> tuple[Optional[float], Optional[int]]:
        try:
            rating_el = page.locator('div[role="img"][aria-label*="estrellas"]').first
            if not await rating_el.is_visible(timeout=2000):
                rating_el = page.locator('span[aria-hidden="true"]').filter(has_text=re.compile(r"^\d[,.]\d$")).first

            aria = await rating_el.get_attribute("aria-label")
            if aria:
                rating_match = re.search(r"([\d,]+)\s*estrellas?", aria, re.I)
                reviews_match = re.search(r"([\d.]+)\s*(reseñas|reviews|opiniones)", aria, re.I)
                rating = float(rating_match.group(1).replace(",", ".")) if rating_match else None
                reviews = int(reviews_match.group(1).replace(".", "")) if reviews_match else None
                return rating, reviews
        except Exception:
            pass
        return None, None

    async def _get_category(self, page: Page) -> Optional[str]:
        try:
            el = page.locator("button.DkEaL").first
            if await el.is_visible(timeout=2000):
                return (await el.inner_text()).strip()
        except Exception:
            pass
        return None

    async def _get_hours(self, page: Page) -> Optional[str]:
        try:
            el = page.locator('[aria-label*="Horario"], [aria-label*="Hours"]').first
            if await el.is_visible(timeout=2000):
                return await el.get_attribute("aria-label")
        except Exception:
            pass
        return None

    def _extract_coords(self, url: str) -> tuple[Optional[float], Optional[float]]:
        match = re.search(r"@(-?\d+\.\d+),(-?\d+\.\d+)", url)
        if match:
            return float(match.group(1)), float(match.group(2))
        return None, None
