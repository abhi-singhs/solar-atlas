"""Collect machine-readable and human-readable provenance for the finished model."""

import json
from pathlib import Path

from rings import RING_NOTES

ROOT = Path(__file__).resolve().parents[1]


def main():
    catalog = json.loads((ROOT / "data/catalog.json").read_text())
    assets = json.loads((ROOT / "data/asset_manifest.json").read_text())
    orientations = json.loads((ROOT / "data/orientations.json").read_text())
    sources = {
        "catalog": catalog,
        "assets": assets,
        "orientations": orientations,
        "rings": RING_NOTES,
        "usage_policy": "Honor individual image credits and rights. NASA hosting does not grant third-party rights.",
        "primary_services": [
            "https://ssd-api.jpl.nasa.gov/doc/horizons.html",
            "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/",
            "https://www.nasa.gov/nasa-brand-center/images-and-media/",
        ],
    }
    (ROOT / "sources.json").write_text(json.dumps(sources, indent=2))
    lines = ["# Sources and credits", "",
             "The source records below distinguish measured data from visual reconstruction.", "",
             "## Orbital and physical data", "",
             "NASA/JPL Horizons supplies all trajectories. The exact requests, solution IDs, "
             "physical references, and checksums are preserved in `data/catalog.json`, "
             "`data/horizons/`, and `sources.json`.", "",
             "Pole and prime-meridian polynomials come from "
             "[NAIF pck00011](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc). "
             "The model omits periodic attitude corrections.", "",
             "| Body | Horizons target |", "| --- | --- |"]
    for body in catalog["bodies"]:
        lines.append(f"| {body['name']} | `{body['horizons_id']}` |")
    lines.extend(["", "## Rings", ""])
    for key, note in RING_NOTES.items():
        lines.append(f"- {key.capitalize()}. {note}")
    lines.extend(["", "## Image assets", "",
                  "Original and processed image checksums, transformations, coverage masks, "
                  "and registration limits are in `data/asset_manifest.json`.", ""])
    for body_id, entry in assets["bodies"].items():
        maps = entry.get("maps", {})
        if not maps:
            continue
        lines.extend([f"### {entry.get('name', body_id)}", ""])
        for role, image in maps.items():
            lines.extend([
                f"- {role.replace('_', ' ')}. {image.get('credit', 'See asset manifest')}.",
                f"  Source: {image.get('source_url', '')}",
                f"  Usage: {image.get('usage', '')}",
                f"  Changes: {image.get('transform', 'See processing record')}.",
            ])
        lines.append("")
    lines.extend(["## Reconstructed content", "",
                  "Procedural terrain, unresolved surface detail, contact-binary geometry, cloud evolution, "
                  "and ring fine structure are visual reconstructions. They are not claimed as new observations.", ""])
    (ROOT / "CREDITS.md").write_text("\n".join(lines))
    print("SOURCE_PACKAGE_COMPLETE")


if __name__ == "__main__":
    main()
