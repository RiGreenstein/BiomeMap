"""Cut classified regions into PNG tiles and package them as PMTiles.

Tile encoding (RGBA PNG, 256 px):
  R  biome id (bit 7 = village/built-up)
  G  (elev + ELEV_OFFSET) >> 8
  B  (elev + ELEV_OFFSET) & 255
  A  255 where data, 0 outside the map
Also writes biomes.json (catalog + stats) and samples.json (teleport targets) for the web app.
"""
from __future__ import annotations

import io
import json
import time

import numpy as np
from PIL import Image
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

from common import ELEV_OFFSET, REGIONS, TILE, WEB_DATA, ZOOM, biome_path, load_biomes, px_to_lat, px_to_lon, pixel_size_m

SAMPLES_PER_BIOME = 400


def encode(biome: np.ndarray, elev: np.ndarray) -> bytes:
    elev = elev.astype(np.int32)
    # Water (ids 1-11) only needs coarse depth for shading; quantizing it shrinks the PNGs a lot.
    water = ((biome & 0x7F) >= 1) & ((biome & 0x7F) <= 11)
    elev = np.where(water, (elev // 25) * 25, elev)
    e = (elev + ELEV_OFFSET).clip(0, 65535)
    rgba = np.empty(biome.shape + (4,), dtype=np.uint8)
    rgba[..., 0] = biome
    rgba[..., 1] = e >> 8
    rgba[..., 2] = e & 255
    rgba[..., 3] = np.where(biome > 0, 255, 0)
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, "PNG", compress_level=9)
    return buf.getvalue()


def downsample(b: np.ndarray, e: np.ndarray):
    """2x downsample, preferring a non-empty pixel from each 2x2 block."""
    out_b, out_e = b[::2, ::2].copy(), e[::2, ::2].copy()
    for dy, dx in ((1, 1), (0, 1), (1, 0)):
        empty = out_b == 0
        out_b[empty] = b[dy::2, dx::2][empty]
        out_e[empty] = e[dy::2, dx::2][empty]
    return out_b, out_e


def main() -> None:
    t0 = time.time()
    biomes = load_biomes()
    rng = np.random.default_rng(42)
    counts = np.zeros(256, dtype=np.int64)
    area = np.zeros(256, dtype=np.float64)
    samples: dict[int, list] = {}
    tiles: dict[tuple[int, int, int], tuple[np.ndarray, np.ndarray]] = {}

    for name, region in REGIONS.items():
        d = np.load(biome_path(name))
        b_all, e_all = d["biome"], d["elev"]
        x0, y0 = region.origin
        ids = b_all & 0x7F
        lats = region.lats()
        counts += np.bincount(ids.ravel(), minlength=256)
        px_km2 = (pixel_size_m(lats) / 1000) ** 2
        for bid in np.unique(ids):
            if bid == 0:
                continue
            rows, cols = np.nonzero(ids == bid)
            area[bid] += px_km2[rows].sum()
            pick = rng.choice(rows.size, size=min(SAMPLES_PER_BIOME, rows.size), replace=False)
            pts = samples.setdefault(int(bid), [])
            for r, c in zip(rows[pick], cols[pick]):
                pts.append([round(float(px_to_lon(x0 + c + 0.5)), 4), round(float(px_to_lat(y0 + r + 0.5)), 4)])
        h, w = b_all.shape
        for ty in range(0, h, TILE):
            for tx in range(0, w, TILE):
                b = b_all[ty:ty + TILE, tx:tx + TILE]
                if b.any():
                    tiles[(ZOOM, (x0 + tx) // TILE, (y0 + ty) // TILE)] = (b.copy(), e_all[ty:ty + TILE, tx:tx + TILE].copy())
        print(f"{name}: {len(tiles)} tiles so far ({time.time() - t0:.0f}s)")

    # Build lower zooms from children.
    level = {k: v for k, v in tiles.items()}
    for z in range(ZOOM - 1, -1, -1):
        parents: dict[tuple[int, int, int], tuple[np.ndarray, np.ndarray]] = {}
        for (_, x, y), (b, e) in level.items():
            key = (z, x // 2, y // 2)
            if key not in parents:
                parents[key] = (np.zeros((TILE, TILE), np.uint8), np.zeros((TILE, TILE), np.int16))
            pb, pe = parents[key]
            db, de = downsample(b, e)
            oy, ox = (y % 2) * (TILE // 2), (x % 2) * (TILE // 2)
            pb[oy:oy + TILE // 2, ox:ox + TILE // 2] = db
            pe[oy:oy + TILE // 2, ox:ox + TILE // 2] = de
        tiles.update(parents)
        level = parents
    print(f"pyramid: {len(tiles)} tiles ({time.time() - t0:.0f}s)")

    WEB_DATA.mkdir(parents=True, exist_ok=True)
    out = WEB_DATA / "biomes.pmtiles"
    with open(out, "wb") as f:
        writer = Writer(f)
        for (z, x, y) in sorted(tiles, key=lambda k: zxy_to_tileid(*k)):
            b, e = tiles[(z, x, y)]
            writer.write_tile(zxy_to_tileid(z, x, y), encode(b, e))
        writer.finalize(
            {
                "tile_type": TileType.PNG,
                "tile_compression": Compression.NONE,
                "min_zoom": 0,
                "max_zoom": ZOOM,
                "min_lon_e7": int(-180 * 1e7),
                "min_lat_e7": int(18 * 1e7),
                "max_lon_e7": int(-65 * 1e7),
                "max_lat_e7": int(72 * 1e7),
                "center_zoom": 4,
                "center_lon_e7": int(-98.5 * 1e7),
                "center_lat_e7": int(39.5 * 1e7),
            },
            {"name": "BiomeMap", "description": "Minecraft-style biomes of the United States",
             "attribution": "ESA WorldCover, WorldClim, Mapzen Terrain Tiles, Natural Earth",
             "encoding": "R=biome id (bit7 village), GB=elevation+12000 m"},
        )
    print(f"wrote {out} ({out.stat().st_size / 1e6:.1f} MB)")

    catalog = []
    for b in biomes:
        catalog.append({**b, "pixels": int(counts[b["id"]]), "area_km2": round(float(area[b["id"]]))})
    (WEB_DATA / "biomes.json").write_text(json.dumps(catalog, indent=1), encoding="utf-8")
    (WEB_DATA / "samples.json").write_text(json.dumps({str(k): v for k, v in samples.items()}), encoding="utf-8")
    missing = [b["name"] for b in catalog if b["pixels"] == 0]
    print("biomes without pixels:", missing or "none")
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
