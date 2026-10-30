"""Shared constants and Web Mercator helpers for the BiomeMap pipeline."""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "cache"
WEB_DATA = ROOT.parent / "web" / "public" / "data"
CACHE.mkdir(exist_ok=True)

# Native data zoom: one data pixel == one "block" in the web map.
ZOOM = 8
TILE = 256
WORLD_PX = TILE * (1 << ZOOM)

# Elevation is stored in the tile G/B channels as uint16 = meters + ELEV_OFFSET.
ELEV_OFFSET = 12000

# WorldCover classes
LC = dict(TREE=10, SHRUB=20, GRASS=30, CROP=40, BUILT=50, BARE=60, SNOW=70,
          WATER=80, WETLAND=90, MANGROVE=95, MOSS=100, NODATA=0)


@dataclass(frozen=True)
class Region:
    name: str
    west: float
    south: float
    east: float
    north: float
    ocean_px: int  # how far (in data pixels) ocean is drawn offshore

    @property
    def tiles(self) -> tuple[int, int, int, int]:
        """Tile-aligned bounds (tx0, ty0, tx1, ty1), exclusive max."""
        tx0 = int(lon_to_px(self.west) // TILE)
        tx1 = int(math.ceil(lon_to_px(self.east) / TILE))
        ty0 = int(lat_to_px(self.north) // TILE)
        ty1 = int(math.ceil(lat_to_px(self.south) / TILE))
        return tx0, ty0, tx1, ty1

    @property
    def shape(self) -> tuple[int, int]:
        tx0, ty0, tx1, ty1 = self.tiles
        return (ty1 - ty0) * TILE, (tx1 - tx0) * TILE

    @property
    def origin(self) -> tuple[int, int]:
        tx0, ty0, _, _ = self.tiles
        return tx0 * TILE, ty0 * TILE

    def lons(self) -> np.ndarray:
        x0, _ = self.origin
        return px_to_lon(x0 + np.arange(self.shape[1]) + 0.5)

    def lats(self) -> np.ndarray:
        _, y0 = self.origin
        return px_to_lat(y0 + np.arange(self.shape[0]) + 0.5)


REGIONS = {
    "hawaii": Region("hawaii", -160.9, 18.5, -154.4, 22.6, ocean_px=64),
    "conus": Region("conus", -126.5, 23.8, -65.5, 49.8, ocean_px=72),
    "alaska": Region("alaska", -179.99, 51.0, -129.5, 71.8, ocean_px=96),
}


def lon_to_px(lon):
    return (np.asarray(lon) + 180.0) / 360.0 * WORLD_PX


def lat_to_px(lat):
    s = np.sin(np.radians(np.asarray(lat)))
    return (0.5 - np.log((1 + s) / (1 - s)) / (4 * math.pi)) * WORLD_PX


def px_to_lon(x):
    return np.asarray(x) / WORLD_PX * 360.0 - 180.0


def px_to_lat(y):
    n = math.pi - 2.0 * math.pi * np.asarray(y) / WORLD_PX
    return np.degrees(np.arctan(np.sinh(n)))


def pixel_size_m(lat):
    """Ground size of one data pixel in meters at a latitude."""
    return 156543.03392 * np.cos(np.radians(lat)) / (1 << ZOOM) * (256 / TILE)


def load_biomes() -> list[dict]:
    return json.loads((ROOT / "biomes.json").read_text(encoding="utf-8"))


def grid_path(region: str) -> Path:
    return CACHE / f"{region}_grid.npz"


def biome_path(region: str) -> Path:
    return CACHE / f"{region}_biome.npz"
