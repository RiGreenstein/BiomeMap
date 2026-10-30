# BiomeMap

An interactive, Minecraft-themed web map of the United States (Lower 48, Alaska, and Hawaii).
Every ~250–500 m "block" is classified into one of 48 Minecraft biomes, such as Desert, Badlands,
Old Growth Spruce Taiga, Mangrove Swamp, Jagged Peaks, and Mushroom Fields. The classification
uses real land-cover, elevation, and climate data.

## Features

- **Pixelated biome map.** It renders with nearest-neighbor resampling. From zoom 10 up, procedural
  16×16 block textures appear (sand, terracotta strata, spruce, flowers, …). Terrain shading comes
  from elevation.
- **Hover / click** a spot to see a Minecraft-style tooltip with the biome name, icon,
  `minecraft:` id, description, temperature, elevation, and whether it's a village (built-up area).
- **Biome legend.** Toggle any biome on or off, or click a name to highlight just that biome.
- **F3 debug screen** (press `F3` or click the button). Shows XYZ "block" coordinates
  (Web Mercator meters plus elevation), lat/lon, chunk, facing, biome, zoom, FPS, and the
  targeted block under the cursor.
- **Random Teleport** to any land biome, or to a specific one. It follows the legend highlight.
- **Shareable links.** The URL hash `#lat,lon,zoom[,biome_key]` stays in sync. Use **Copy Link**,
  e.g. `#21.45,-157.95,8.50,jungle`.
- **Options** (button in the hotbar): jump to Lower 48 / Alaska / Hawaii, and toggle terrain
  shading, block textures, state borders, and city labels.

## Project layout

```
pipeline/             Python data pipeline
  common.py           regions, Web Mercator helpers, paths
  download.py         fetches the source data and builds raw per-region grids
  preprocess.py       US mask, sea/lake/river detection, slope/relief, climate sampling, noise
  biome_rules.yaml    ordered, editable classification rules (numpy expressions)
  biomes.json         biome catalog: id, name, color, texture, description
  classify.py         applies the rules -> cache/<region>_biome.npz (+ preview PNG)
  tile.py             builds the PNG tile pyramid -> web/public/data/biomes.pmtiles
  run_all.py          runs everything
web/                  Vite + TypeScript + MapLibre GL app
  src/tiles.ts        PMTiles reader, decoder, renderer (biome:// protocol), point lookup
  src/textures.ts     procedural block textures and icons
  src/ui/*            tooltip, legend, F3, teleport, share links, options, chat
```

## Running it

Requirements: Python 3.11+ and Node 20+.

```powershell
# 1. Build the data (downloads ~200 MB on the first run; takes a few minutes)
cd pipeline
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python run_all.py

# 2. Run the web app
cd ..\web
npm install
npm run dev          # http://localhost:5173
npm run build        # static site in web/dist (serve with any static host that supports HTTP range requests)
```

After editing `biome_rules.yaml`, run `python run_all.py --reclassify`. Downloads are cached.

## GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds the map data and web app, then deploys
to GitHub Pages whenever `main` is updated. In the repository's **Settings → Pages**, select
**GitHub Actions** as the build and deployment source. The generated data and `web/dist/` are
intentionally not committed; the workflow regenerates them for each deployment.

## How biomes are decided

The data is a single Web Mercator grid at zoom 8 (one pixel ≈ 610 m × cos(latitude)):

| Layer | Source |
|---|---|
| Land cover (trees, shrub, grass, crops, built-up, bare, snow/ice, water, wetland, mangroves, moss) | [ESA WorldCover 2021](https://esa-worldcover.org) (10 m, read from cloud-optimized overviews) |
| Elevation + ocean depth | [Mapzen / AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium) |
| Climate (annual mean temp, coldest-month min, warmest-quarter mean, annual precipitation) | [WorldClim 2.1](https://worldclim.org) 10′, lapse-rate corrected with the fine DEM |
| State outlines, cities | [Natural Earth](https://www.naturalearthdata.com) |

Derived layers include slope, local relief (~4 km window), Köppen-style aridity
(`P < 20·T + 280`), coastline adjacency, and ocean vs. lake vs. river (by connectivity and
size). Ocean is drawn offshore only where it is closer to the US than to another country. Rules in
`biome_rules.yaml` are evaluated top to bottom; the first match wins. Some examples:

- Permanent snow/ice → Jagged Peaks / Ice Spikes / Frozen Peaks / Snowy Slopes, by slope, relief, and elevation
- Above the treeline (warmest quarter < 10 °C) in mountains → Stony / Frozen / Jagged Peaks, Grove, Meadow
- Arid and rugged mid-elevation plateaus → Badlands; very dry lowland → Desert
- Wet Pacific Northwest and Southeast Alaska conifer forest → Old Growth Spruce / Pine Taiga
- Humid eastern ridges → Dark Forest; cool northern hardwoods → Birch Forest
- Built-up land keeps its climate biome but is flagged as a **village**
- San Nicolas Island, CA is a Mushroom Fields island (easter egg)

Sanity checks used while tuning: Death Valley → Desert, Olympic NP → Old Growth Spruce Taiga,
Everglades → Mangrove Swamp, Denali → Frozen Peaks, Great Smokies → Dark Forest,
Kauai → Jungle, North Slope → Snowy Plains, Lake Michigan → Cold Ocean.

## Tile format

`biomes.pmtiles` holds 256 px RGBA PNG tiles (z0–8):

- `R` = biome id (bit 7 = village)
- `G<<8 | B` = elevation + 12000 m
- `A` = 0 outside the map

The browser decodes them and colors them at runtime through a custom `biome://` MapLibre
protocol. That's why filters, highlights, shading, and block textures work without
regenerating tiles. Zoom levels 9–12 are synthesized client-side by upscaling the z8 data into
textured blocks.

## Known limitations

- Resolution is ~250–500 m per block, so very small features (narrow rivers, small islands) can vanish.
- Climate is coarse (~18 km), so some biome boundaries follow smooth climate contours.
- The far-western Aleutian Islands (west of 180°) are not included.
- City labels load glyphs from `demotiles.maplibre.org`.

## Credits & legal

Biome names describe Minecraft concepts for fun. No Mojang textures, sounds, fonts, or logos
are used: block textures are generated procedurally, and the UI font is
[Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans) (OFL).
**Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.**

Data: ESA WorldCover © ESA 2021 (CC BY 4.0); WorldClim 2.1; Terrain Tiles (Mapzen, USGS, NOAA,
and others); Natural Earth (public domain).
