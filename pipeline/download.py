"""Download source datasets and assemble raw per-region grids.

Outputs (pipeline/cache):
  us_states_10m.geojson           US state polygons (Natural Earth 10m) used for masking
  worldclim/*.tif                 WorldClim 2.1 10-arc-minute bioclim + elevation
  <region>_grid.npz               elev (int16 m) and lc (uint8 WorldCover class) on the z8 Web Mercator grid
Outputs (web/public/data):
  states.geojson, cities.geojson  Display overlays
"""
from __future__ import annotations

import io
import json
import os
import sys
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
from PIL import Image

from common import CACHE, REGIONS, TILE, WEB_DATA, ZOOM, Region, grid_path

NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
WORLDCLIM = "https://geodata.ucdavis.edu/climate/worldclim/2_1/base/"
TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
WORLDCOVER = ("/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
              "ESA_WorldCover_10m_2021_v200_{tile}_Map.tif")
WC_OVERVIEW = 4  # factor 32 -> ~300 m pixels

session = requests.Session()


def get(url: str, retries: int = 4) -> bytes:
    for attempt in range(retries):
        try:
            r = session.get(url, timeout=120)
            if r.status_code == 404:
                return b""
            r.raise_for_status()
            return r.content
        except requests.RequestException:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)
    return b""


def round_coords(obj, nd=3):
    if isinstance(obj, list):
        if obj and isinstance(obj[0], (int, float)):
            return [round(v, nd) for v in obj]
        return [round_coords(v, nd) for v in obj]
    return obj


def fetch_natural_earth() -> None:
    states_path = CACHE / "us_states_10m.geojson"
    if not states_path.exists():
        print("Natural Earth 10m states ...")
        data = json.loads(get(NE + "ne_10m_admin_1_states_provinces.geojson"))
        feats = [f for f in data["features"] if f["properties"].get("adm0_a3") == "USA"]
        for f in feats:
            f["properties"] = {"name": f["properties"].get("name"), "postal": f["properties"].get("postal")}
        states_path.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
        del data

    WEB_DATA.mkdir(parents=True, exist_ok=True)
    if not (WEB_DATA / "states.geojson").exists():
        print("Natural Earth 50m state lines ...")
        data = json.loads(get(NE + "ne_50m_admin_1_states_provinces_lakes.geojson"))
        feats = [{"type": "Feature", "properties": {"name": f["properties"].get("name")},
                  "geometry": {"type": f["geometry"]["type"],
                               "coordinates": round_coords(f["geometry"]["coordinates"])}}
                 for f in data["features"] if f["properties"].get("adm0_a3") == "USA"]
        (WEB_DATA / "states.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))

    if not (WEB_DATA / "cities.geojson").exists():
        print("Natural Earth populated places ...")
        data = json.loads(get(NE + "ne_10m_populated_places_simple.geojson"))
        feats = []
        for f in data["features"]:
            p = f["properties"]
            if p.get("adm0_a3") != "USA" or p.get("scalerank", 99) > 7:
                continue
            feats.append({"type": "Feature",
                          "properties": {"name": p.get("name"), "rank": p.get("scalerank"),
                                         "pop": p.get("pop_max")},
                          "geometry": {"type": "Point",
                                       "coordinates": round_coords(f["geometry"]["coordinates"], 4)}})
        (WEB_DATA / "cities.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))


def fetch_worldclim() -> None:
    out = CACHE / "worldclim"
    wanted = {"bio_1", "bio_6", "bio_10", "bio_12"}
    out.mkdir(exist_ok=True)
    if not all((out / f"{w}.tif").exists() for w in wanted):
        print("WorldClim bioclim (10m) ...")
        with zipfile.ZipFile(io.BytesIO(get(WORLDCLIM + "wc2.1_10m_bio.zip"))) as z:
            for name in z.namelist():
                key = name.replace("wc2.1_10m_", "").replace(".tif", "")
                if key in wanted:
                    (out / f"{key}.tif").write_bytes(z.read(name))
    if not (out / "elev.tif").exists():
        print("WorldClim elevation (10m) ...")
        with zipfile.ZipFile(io.BytesIO(get(WORLDCLIM + "wc2.1_10m_elev.zip"))) as z:
            name = next(n for n in z.namelist() if n.endswith(".tif"))
            (out / "elev.tif").write_bytes(z.read(name))


def fetch_terrarium(region: Region) -> np.ndarray:
    tx0, ty0, tx1, ty1 = region.tiles
    h, w = region.shape
    elev = np.zeros((h, w), dtype=np.int16)

    def job(t):
        tx, ty = t
        raw = get(TERRARIUM.format(z=ZOOM, x=tx, y=ty))
        if not raw:
            return
        a = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"), dtype=np.float32)
        e = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
        oy, ox = (ty - ty0) * TILE, (tx - tx0) * TILE
        elev[oy:oy + TILE, ox:ox + TILE] = np.clip(np.round(e), -11000, 9000).astype(np.int16)

    tiles = [(x, y) for y in range(ty0, ty1) for x in range(tx0, tx1)]
    done = 0
    with ThreadPoolExecutor(16) as ex:
        for _ in ex.map(job, tiles):
            done += 1
            if done % 200 == 0:
                print(f"  terrarium {done}/{len(tiles)}")
    return elev


def wc_tile_names(region: Region) -> list[tuple[str, int, int]]:
    names = []
    lat = int(np.floor(region.south / 3) * 3)
    while lat < region.north:
        lon = int(np.floor(region.west / 3) * 3)
        while lon < region.east:
            ns = f"N{lat:02d}" if lat >= 0 else f"S{-lat:02d}"
            ew = f"W{-lon:03d}" if lon < 0 else f"E{lon:03d}"
            names.append((ns + ew, lat, lon))
            lon += 3
        lat += 3
    return names


def fetch_worldcover(region: Region) -> np.ndarray:
    import rasterio
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
    h, w = region.shape
    lc = np.zeros((h, w), dtype=np.uint8)
    lats, lons = region.lats(), region.lons()

    def job(item):
        name, lat0, lon0 = item
        rows = np.nonzero((lats >= lat0) & (lats < lat0 + 3))[0]
        cols = np.nonzero((lons >= lon0) & (lons < lon0 + 3))[0]
        if rows.size == 0 or cols.size == 0:
            return 0
        for attempt in range(3):
            try:
                with rasterio.Env(GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="1"):
                    with rasterio.open(WORLDCOVER.format(tile=name), overview_level=WC_OVERVIEW) as ds:
                        a = ds.read(1)
                break
            except rasterio.errors.RasterioIOError as e:
                if "404" in str(e) or "No such file" in str(e) or "not recognized" in str(e) or attempt == 2:
                    return 0
                time.sleep(2)
        n = a.shape[0]
        r = np.clip(((lat0 + 3 - lats[rows]) / 3 * n).astype(int), 0, n - 1)
        c = np.clip(((lons[cols] - lon0) / 3 * a.shape[1]).astype(int), 0, a.shape[1] - 1)
        lc[np.ix_(rows, cols)] = a[np.ix_(r, c)]
        return 1

    names = wc_tile_names(region)
    found = 0
    with ThreadPoolExecutor(8) as ex:
        for i, ok in enumerate(ex.map(job, names), 1):
            found += ok
            if i % 25 == 0:
                print(f"  worldcover {i}/{len(names)} ({found} with data)")
    return lc


def main(regions: list[str]) -> None:
    fetch_natural_earth()
    fetch_worldclim()
    for name in regions:
        path = grid_path(name)
        if path.exists():
            print(f"{name}: grid cached")
            continue
        region = REGIONS[name]
        print(f"{name}: {region.shape[1]}x{region.shape[0]} px, tiles {region.tiles}")
        t = time.time()
        elev = fetch_terrarium(region)
        print(f"  elevation done in {time.time() - t:.0f}s")
        t = time.time()
        lc = fetch_worldcover(region)
        print(f"  land cover done in {time.time() - t:.0f}s")
        np.savez_compressed(path, elev=elev, lc=lc)


if __name__ == "__main__":
    main(sys.argv[1:] or list(REGIONS))
