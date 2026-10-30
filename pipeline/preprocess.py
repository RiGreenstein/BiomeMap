"""Derived layers for classification: US mask, sea/inland water, terrain, climate, noise."""
from __future__ import annotations

import json
import zlib

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from scipy import ndimage

from common import CACHE, LC, Region, lat_to_px, lon_to_px, pixel_size_m

LAPSE_RATE = -0.0065  # degC per meter


def rasterize_us(region: Region) -> np.ndarray:
    """Rasterize US state polygons to the region grid (bool)."""
    h, w = region.shape
    x0, y0 = region.origin
    img = Image.new("1", (w, h), 0)
    draw = ImageDraw.Draw(img)
    data = json.loads((CACHE / "us_states_10m.geojson").read_text())

    def ring_px(ring):
        a = np.asarray(ring, dtype=np.float64)
        xs = lon_to_px(a[:, 0]) - x0
        ys = lat_to_px(np.clip(a[:, 1], -85, 85)) - y0
        return list(zip(xs.tolist(), ys.tolist()))

    for f in data["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poly in polys:
            # Skip the Aleutian islands west of the antimeridian (they have positive longitudes).
            if max(p[0] for p in poly[0]) > 0:
                continue
            draw.polygon(ring_px(poly[0]), fill=1)
            for hole in poly[1:]:
                draw.polygon(ring_px(hole), fill=0)
    return np.asarray(img, dtype=bool)


def water_masks(region: Region, lc: np.ndarray, us: np.ndarray):
    """Return (land_us, sea, inland) bool masks for the region.

    sea     ocean-like water drawn on the map (ocean + Great Lakes + huge lakes)
    inland  rivers and small/medium lakes inside the US
    """
    land = (lc != LC["NODATA"]) & (lc != LC["WATER"])
    us_dil = ndimage.binary_dilation(us, iterations=2)

    # Foreign land = land outside the US that is part of a landmass touching the US (Canada,
    # Mexico) or a large separate landmass. Small islets missing from the state polygons are not
    # foreign; they are claimed below if they sit in US waters.
    comp, ncomp = ndimage.label(land, structure=np.ones((3, 3), bool))
    comp_size = np.bincount(comp.ravel(), minlength=ncomp + 1)
    touches_us = np.zeros(ncomp + 1, bool)
    touches_us[np.unique(comp[us])] = True
    big_or_mainland = touches_us | (comp_size > 4000)
    big_or_mainland[0] = False
    # Mainland coastline can poke slightly beyond the generalized polygons, so only land well
    # beyond the US outline counts as foreign.
    far = ~ndimage.binary_dilation(us, iterations=12)
    foreign = land & far & big_or_mainland[comp]
    islet = land & ~touches_us[comp]
    del comp

    water = ~land
    labels, n = ndimage.label(water, structure=np.ones((3, 3), bool))
    sizes = np.bincount(labels.ravel(), minlength=n + 1)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))

    # Area threshold for treating a lake as an ocean-like body.
    lat_mid = (region.north + region.south) / 2
    px_km2 = (pixel_size_m(lat_mid) / 1000) ** 2
    big = sizes * px_km2 > 1500
    oceanlike = big.copy()
    oceanlike[border] = True
    oceanlike[0] = False
    sea_all = oceanlike[labels]
    del labels

    inland = water & ~sea_all & us
    # Ocean-like water is shown inside the US or offshore when it is closer to US land than to foreign land.
    f = 4
    us_small = (land & us_dil)[::f, ::f]
    fr_small = foreign[::f, ::f]
    d_us = ndimage.distance_transform_edt(~us_small) if us_small.any() else np.full(us_small.shape, 1e9)
    d_fr = ndimage.distance_transform_edt(~fr_small) if fr_small.any() else np.full(us_small.shape, 1e9)
    own = (d_us * f <= region.ocean_px) & (d_us <= d_fr)
    own = np.kron(own, np.ones((f, f), dtype=bool))[: lc.shape[0], : lc.shape[1]]
    sea = sea_all & (own | us)
    land_us = land & (us_dil | (own & islet))
    return land_us, sea, inland


def terrain(elev: np.ndarray, lats: np.ndarray, relief_km: float = 4.0):
    """Slope (degrees, float32) and local relief (m, int16) for a block of rows."""
    e = elev.astype(np.float32)
    px = pixel_size_m(lats).astype(np.float32)[:, None]
    gy, gx = np.gradient(e)
    slope = np.degrees(np.arctan(np.hypot(gx, gy) / px))
    size = max(3, int(round(relief_km * 1000 / float(np.median(px)))) | 1)
    relief = ndimage.maximum_filter(elev, size=size) - ndimage.minimum_filter(elev, size=size)
    return slope.astype(np.float32), relief.astype(np.int16), size // 2


class Climate:
    """Bilinear sampler for WorldClim 10' grids, with lapse-rate temperature correction."""

    def __init__(self):
        self.vars = {}
        for key in ("bio_1", "bio_6", "bio_10", "bio_12", "elev"):
            with rasterio.open(CACHE / "worldclim" / f"{key}.tif") as ds:
                a = ds.read(1).astype(np.float32)
                nodata = ds.nodata
            bad = ~np.isfinite(a) | (a < -1e30) if nodata is None else (a == np.float32(nodata)) | ~np.isfinite(a)
            # Fill ocean/no-data with the nearest valid value so coastlines get sensible climate.
            idx = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
            self.vars[key] = a[tuple(idx)]

    def sample(self, lats: np.ndarray, lons: np.ndarray, elev: np.ndarray) -> dict:
        r = (90.0 - lats) * 6.0 - 0.5
        c = (lons + 180.0) * 6.0 - 0.5
        rr, cc = np.meshgrid(r, c, indexing="ij")
        coords = np.stack([rr.ravel(), cc.ravel()])
        shape = (lats.size, lons.size)
        out = {k: ndimage.map_coordinates(v, coords, order=1, mode="nearest").reshape(shape)
               for k, v in self.vars.items()}
        dz = np.maximum(elev, 0).astype(np.float32) - np.maximum(out["elev"], 0)
        adj = LAPSE_RATE * dz
        return {
            "T": out["bio_1"] + adj,
            "Tmin": out["bio_6"] + adj,
            "Twarm": out["bio_10"] + adj,
            "P": out["bio_12"],
        }


class Noise:
    """Smooth deterministic value noise in [0, 1] used for patchy variant biomes."""

    def __init__(self, region: Region, cell: int = 24):
        h, w = region.shape
        rng = np.random.default_rng(zlib.crc32(region.name.encode()))
        self.cell = cell
        self.grid = rng.random((h // cell + 2, w // cell + 2)).astype(np.float32)

    def sample(self, r0: int, r1: int, w: int) -> np.ndarray:
        rr, cc = np.meshgrid(np.arange(r0, r1) / self.cell, np.arange(w) / self.cell, indexing="ij")
        return ndimage.map_coordinates(self.grid, [rr.ravel(), cc.ravel()], order=1).reshape(r1 - r0, w)
