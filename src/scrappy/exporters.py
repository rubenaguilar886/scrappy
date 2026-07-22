import asyncio
import csv
import json
import re
from pathlib import Path
from typing import List

from scrappy.models import Business


def export_csv(businesses: List[Business], output_path: Path) -> Path:
    """Exporta negocios a CSV compatible con Google Sheets."""
    if not businesses:
        raise ValueError("No hay negocios para exportar")

    rows = [b.to_sheet_row() for b in businesses]
    fieldnames = list(rows[0].keys())

    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    return output_path


def export_json(businesses: List[Business], output_path: Path) -> Path:
    """Exporta negocios a JSON."""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    data = [b.model_dump(mode="json") for b in businesses]

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)

    return output_path
