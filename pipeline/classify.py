"""Classify each region grid into Minecraft biome IDs using biome_rules.yaml.

Output: cache/<region>_biome.npz with
  biome  uint8   biome id (0 = outside the map); bit 7 is set for built-up "village" pixels
  elev   int16   elevation in meters
Also writes cache/<region>_preview.png.
"""
from __future__ import annotations

import sys
import time

import numpy as np
import yaml
from PIL import Image
from scipy import ndimage

from common import CACHE, LC, REGIONS, ROOT, biome_path, grid_path, load_biomes, lat_to_px, lon_to_px
from preprocess import Climate, Noise, rasterize_us, terrain, water_masks

CHUNK = 1024
VILLAGE_BIT = 0x80


class RuleSet:
    def __init__(self, path=ROOT / "biome_rules.yaml"):
        cfg = yaml.safe_load(path.read_text(encoding="utf-8"))
        self.biomes = {b["key"]: b["id"] for b in load_biomes()}
        self.defs = [(k, compile(v, f"def:{k}", "eval")) for k, v in cfg.get("defs", {}).items()]
        self.domains = {}
        for domain in ("sea", "inland_water", "land"):
            rules = []
            for r in cfg[domain]:
                if r["biome"] not in self.biomes:
                    raise ValueError(f"Unknown biome {r['biome']!r} in rules")
                rules.append((self.biomes[r["biome"]], compile(r["when"], f"{domain}:{r['biome']}", "eval"), r["when"]))
            self.domains[domain] = rules
        self.easter_eggs = [(lon, lat, self.biomes[b]) for lon, lat, b in cfg.get("easter_eggs", [])]

    def apply(self, env: dict, masks: dict, out: np.ndarray) -> None:
        scope = {"isin": np.isin, "np": np, **{k: v for k, v in LC.items()}, **env}
        for name, code in self.defs:
            scope[name] = eval(code, {"__builtins__": {}}, scope)
        for domain, mask in masks.items():
            todo = mask.copy()
            for biome_id, code, src in self.domains[domain]:
                if not todo.any():
                    break
                hit = np.broadcast_to(eval(code, {"__builtins__": {}}, scope), todo.shape) & todo
                out[hit] = biome_id
                todo &= ~hit


def classify_region(name: str, rules: RuleSet, climate: Climate) -> None:
    region = REGIONS[name]
    t0 = time.time()
    g = np.load(grid_path(name))
    elev, lc = g["elev"], g["lc"]
    h, w = elev.shape
    lats, lons = region.lats(), region.lons()

    us = rasterize_us(region)
    land, sea, inland = water_masks(region, lc, us)
    coast = land & ndimage.binary_dilation(sea, structure=np.ones((3, 3), bool))
    print(f"  masks in {time.time() - t0:.0f}s (land {land.mean():.1%}, sea {sea.mean():.1%})")

    noise = Noise(region)
    biome = np.zeros((h, w), dtype=np.uint8)
    halo = 16
    for r0 in range(0, h, CHUNK):
        r1 = min(h, r0 + CHUNK)
        if not (land[r0:r1].any() or sea[r0:r1].any() or inland[r0:r1].any()):
            continue
        a0, a1 = max(0, r0 - halo), min(h, r1 + halo)
        slope, relief, _ = terrain(elev[a0:a1], lats[a0:a1])
        s = slice(r0 - a0, r0 - a0 + (r1 - r0))
        e = elev[r0:r1]
        env = dict(
            lc=lc[r0:r1], elev=e, slope=slope[s], relief=relief[s],
            lat=lats[r0:r1, None], lon=lons[None, :], coast=coast[r0:r1],
            noise=noise.sample(r0, r1, w), **climate.sample(lats[r0:r1], lons, e),
        )
        rules.apply(env, {"sea": sea[r0:r1], "inland_water": inland[r0:r1], "land": land[r0:r1]}, biome[r0:r1])
        print(f"  rows {r0}-{r1} done ({time.time() - t0:.0f}s)")

    x0, y0 = region.origin
    land_labels = None
    for lon, lat, biome_id in rules.easter_eggs:
        px, py = int(lon_to_px(lon) - x0), int(lat_to_px(lat) - y0)
        if 0 <= py < h and 0 <= px < w:
            if land_labels is None:
                land_labels, _ = ndimage.label(land)
            lab = land_labels[py, px]
            if lab and (land_labels == lab).sum() < 5000:
                biome[(land_labels == lab)] = biome_id

    biome[(lc == LC["BUILT"]) & land] |= VILLAGE_BIT
    np.savez_compressed(biome_path(name), biome=biome, elev=elev)
    save_preview(name, biome)
    print(f"{name}: classified in {time.time() - t0:.0f}s")


def save_preview(name: str, biome: np.ndarray, step: int = 4) -> None:
    palette = np.zeros((256, 3), dtype=np.uint8)
    for b in load_biomes():
        c = b["color"].lstrip("#")
        rgb = [int(c[i:i + 2], 16) for i in (0, 2, 4)]
        palette[b["id"]] = rgb
        palette[b["id"] | VILLAGE_BIT] = rgb
    palette[0] = (30, 30, 30)
    Image.fromarray(palette[biome[::step, ::step]]).save(CACHE / f"{name}_preview.png")


def main(names: list[str]) -> None:
    rules = RuleSet()
    climate = Climate()
    for name in names:
        print(f"{name}: classifying")
        classify_region(name, rules, climate)


if __name__ == "__main__":
    main(sys.argv[1:] or list(REGIONS))
