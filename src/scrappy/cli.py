import asyncio
from datetime import datetime
from pathlib import Path

import click
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table

from scrappy.exporters import export_csv, export_json
from scrappy.scrapers.google_maps import GoogleMapsScraper
from scrappy.scrapers.produce_directory import DEFAULT_CSV, ProduceDirectoryScraper

console = Console()


@click.group()
@click.version_option(version="0.1.0", prog_name="scrappy")
def cli():
    """Scrappy - Scraper de directorios de negocios."""
    pass


# ── scrape (Google Maps) ──────────────────────────────────────────────────────

@cli.command()
@click.argument("query")
@click.option("--location", "-l", default="Lima, Peru",
              help="Ubicacion geografica (ej: 'Lima, Peru', 'Miraflores, Lima')")
@click.option("--max-results", "-n", default=20, show_default=True,
              help="Cantidad maxima de resultados")
@click.option("--output", "-o", default=None,
              help="Archivo de salida (CSV). Si no se especifica, se genera automaticamente.")
@click.option("--format", "-f", "output_format",
              type=click.Choice(["csv", "json", "both"], case_sensitive=False),
              default="csv", show_default=True, help="Formato de exportacion")
@click.option("--headless/--no-headless", default=True,
              help="Ejecutar navegador en modo invisible")
@click.option("--show-browser", is_flag=True,
              help="Mostrar el navegador mientras scrapea (util para debug)")
def scrape(query, location, max_results, output, output_format, headless, show_browser):
    """Scrapea Google Maps por categoria y ubicacion.

    Ejemplos:

      scrappy scrape "veterinarias" -l "Lima, Peru"

      scrappy scrape "pet grooming" -l "Miraflores, Lima" -n 50

      scrappy scrape "veterinarias grooming" -l "San Isidro, Lima" -f both
    """
    if show_browser:
        headless = False

    full_query = f"{query} {location}".strip()
    console.print(f"\n[bold blue]Buscando:[/bold blue] {full_query}")
    console.print(f"[dim]Maximo de resultados: {max_results}[/dim]\n")

    scraper = GoogleMapsScraper(headless=headless)

    with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"),
                  console=console) as progress:
        task = progress.add_task("Scrapeando Google Maps...", total=None)
        businesses = asyncio.run(scraper.search(query, location, max_results))
        progress.update(task, description=f"Encontrados: {len(businesses)} negocios")

    if not businesses:
        console.print("[yellow]No se encontraron negocios. Intenta con otra busqueda.[/yellow]")
        return

    _print_results_table(businesses)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_query = "".join(c if c.isalnum() else "_" for c in query)[:30]
    output_dir = Path("output")

    if output_format in ("csv", "both"):
        csv_path = (Path(output) if output and output.endswith(".csv")
                    else output_dir / f"{safe_query}_{timestamp}.csv")
        export_csv(businesses, csv_path)
        console.print(f"\n[green]CSV exportado:[/green] {csv_path.resolve()}")

    if output_format in ("json", "both"):
        json_path = output_dir / f"{safe_query}_{timestamp}.json"
        export_json(businesses, json_path)
        console.print(f"[green]JSON exportado:[/green] {json_path.resolve()}")

    console.print(f"\n[dim]Tip: Importa el CSV en Google Sheets -> Archivo -> Importar -> Subir[/dim]")


# ── scrape-produce (PRODUCE/CIIU) ─────────────────────────────────────────────

@cli.command("scrape-produce")
@click.option("--ciiu", "-c", default="",
              help="Codigo(s) CIIU-3 separados por coma (ej: 7310,7830). Vacio = todos.")
@click.option("--departamento", "-d", default="LIMA", show_default=True,
              help="Departamento a filtrar (en mayusculas).")
@click.option("--provincia", "-p", default=None,
              help="Provincia a filtrar (opcional).")
@click.option("--distrito", default=None,
              help="Distrito a filtrar (opcional).")
@click.option("--sector", "-s", default=None,
              help="Sector productivo (ej: SERVICIO, INDUSTRIA).")
@click.option("--max-results", "-n", default=200, show_default=True,
              help="Maximo de empresas a extraer del CSV.")
@click.option("--enrich/--no-enrich", default=True, show_default=True,
              help="Buscar contacto en Google para cada empresa.")
@click.option("--enrich-concurrency", default=3, show_default=True,
              help="Busquedas paralelas durante el enriquecimiento.")
@click.option("--csv-path", default=str(DEFAULT_CSV), show_default=True,
              help="Ruta al CSV de PRODUCE descargado.")
@click.option("--output", "-o", default=None,
              help="Archivo de salida. Si no se indica, se genera automaticamente.")
@click.option("--format", "-f", "output_format",
              type=click.Choice(["csv", "json", "both"], case_sensitive=False),
              default="csv", show_default=True)
@click.option("--show-browser", is_flag=True,
              help="Mostrar navegador durante el enriquecimiento (debug).")
def scrape_produce(ciiu, departamento, provincia, distrito, sector,
                   max_results, enrich, enrich_concurrency, csv_path,
                   output, output_format, show_browser):
    """Extrae leads del directorio MIPYME de PRODUCE y enriquece con contacto.

    Ejemplos:

      scrappy scrape-produce --ciiu 7310 --departamento LIMA

      scrappy scrape-produce --ciiu 7310,7830 -n 50 --sector SERVICIO

      scrappy scrape-produce --ciiu 7310 --no-enrich -f json
    """
    ciiu_codes = [c.strip() for c in ciiu.split(",") if c.strip()] if ciiu else []

    console.print(f"\n[bold magenta]PRODUCE / CIIU[/bold magenta]")
    console.print(f"  CIIU:           {', '.join(ciiu_codes) or '(todos)'}")
    console.print(f"  Departamento:   {departamento.upper()}")
    if provincia:
        console.print(f"  Provincia:      {provincia.upper()}")
    if distrito:
        console.print(f"  Distrito:       {distrito.upper()}")
    if sector:
        console.print(f"  Sector:         {sector.upper()}")
    console.print(f"  Max resultados: {max_results}")
    console.print(f"  Enriquecimiento: {'Si' if enrich else 'No'}\n")

    # 1. Cargar del CSV
    scraper = ProduceDirectoryScraper(csv_path=csv_path)

    with Progress(SpinnerColumn(), TextColumn("{task.description}"), console=console) as prog:
        t = prog.add_task("Leyendo CSV de PRODUCE...", total=None)
        try:
            businesses = asyncio.run(
                scraper.search_by_ciiu(
                    ciiu_codes=ciiu_codes,
                    departamento=departamento.upper(),
                    provincia=provincia.upper() if provincia else None,
                    distrito=distrito.upper() if distrito else None,
                    sector=sector.upper() if sector else None,
                    max_results=max_results,
                )
            )
        except FileNotFoundError as e:
            console.print(f"[red]{e}[/red]")
            return
        prog.update(t, description=f"  {len(businesses)} empresas cargadas del CSV")

    if not businesses:
        console.print("[yellow]No se encontraron empresas con esos filtros.[/yellow]")
        return

    _print_produce_table(businesses)

    # 2. Enriquecimiento de contacto
    if enrich:
        from scrappy.enrichers.contact_enricher import ContactEnricher
        enricher = ContactEnricher(
            headless=not show_browser,
            concurrency=enrich_concurrency,
        )
        businesses = asyncio.run(enricher.enrich(businesses))

        found = sum(1 for b in businesses if b.enrichment_status == "encontrado")
        no_contact = sum(1 for b in businesses if b.enrichment_status == "sin_contacto")
        console.print(f"\n[bold]Resumen de enriquecimiento:[/bold]")
        console.print(f"  [green]Con contacto:[/green]   {found}")
        console.print(f"  [yellow]Sin contacto:[/yellow]  {no_contact}")
        console.print(f"  [dim]Filtra 'Estado Enriquecimiento'='sin_contacto' en el CSV "
                      f"para revision manual.[/dim]")

    # 3. Exportar
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    ciiu_tag = ciiu.replace(",", "-") or "all"
    output_dir = Path("output")

    if output_format in ("csv", "both"):
        csv_out = (Path(output) if output and output.endswith(".csv")
                   else output_dir / f"produce_{ciiu_tag}_{departamento.lower()}_{timestamp}.csv")
        export_csv(businesses, csv_out)
        console.print(f"\n[green]CSV exportado:[/green] {csv_out.resolve()}")

    if output_format in ("json", "both"):
        json_out = output_dir / f"produce_{ciiu_tag}_{departamento.lower()}_{timestamp}.json"
        export_json(businesses, json_out)
        console.print(f"[green]JSON exportado:[/green] {json_out.resolve()}")

    console.print(
        "\n[dim]Tip: Importa el CSV en Google Sheets -> "
        "Archivo -> Importar -> Subir (separador: coma)[/dim]\n"
    )


# ── Helpers de tabla ──────────────────────────────────────────────────────────

def _print_produce_table(businesses):
    table = Table(title=f"Empresas PRODUCE ({len(businesses)} resultados)")
    table.add_column("#", style="dim", width=4)
    table.add_column("Razon Social", style="bold", max_width=38)
    table.add_column("RUC", width=12)
    table.add_column("CIIU", width=6)
    table.add_column("Categoria", max_width=28)
    table.add_column("Distrito", max_width=18)

    for i, b in enumerate(businesses[:30], 1):
        table.add_row(
            str(i),
            b.name[:38],
            b.ruc or "-",
            b.ciiu_code or "-",
            (b.ciiu_desc or "-")[:28],
            (b.distrito or "-")[:18],
        )

    if len(businesses) > 30:
        table.add_row("...", f"(+{len(businesses)-30} mas en el CSV)", "", "", "", "")

    console.print(table)


def _print_results_table(businesses):
    table = Table(title=f"Resultados ({len(businesses)} negocios)")
    table.add_column("#", style="dim", width=4)
    table.add_column("Nombre", style="bold")
    table.add_column("Direccion", max_width=35)
    table.add_column("Telefono")
    table.add_column("Rating")

    for i, b in enumerate(businesses, 1):
        rating = f"* {b.rating} ({b.reviews_count})" if b.rating else "-"
        table.add_row(
            str(i),
            b.name[:40],
            (b.address or "-")[:35],
            b.phone or "-",
            rating,
        )

    console.print(table)


if __name__ == "__main__":
    cli()
