"""Run the whole pipeline: download -> classify -> tile.

Usage: python run_all.py [--reclassify] [region ...]
Downloads are cached in pipeline/cache; pass --reclassify after editing biome_rules.yaml.
"""
from __future__ import annotations

import sys

import classify
import download
import tile
from common import REGIONS, biome_path


def main(argv: list[str]) -> None:
    force = "--reclassify" in argv
    regions = [a for a in argv if not a.startswith("--")] or list(REGIONS)
    download.main(regions)
    todo = [r for r in regions if force or not biome_path(r).exists()]
    if todo:
        classify.main(todo)
    tile.main()


if __name__ == "__main__":
    main(sys.argv[1:])
