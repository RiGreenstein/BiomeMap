import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/700.css";
import "./styles.css";
import { loadBiomes } from "./biomes";
import { createApp } from "./state";
import { dirtPattern } from "./textures";
import { BiomeTiles, RENDER_MAX_ZOOM } from "./tiles";
import { chat } from "./ui/chat";
import { setupF3 } from "./ui/f3";
import { setupLegend } from "./ui/legend";
import { setupOptions } from "./ui/options";
import { applyBiome, parseHash, setupShare } from "./ui/share";
import { setupTeleport } from "./ui/teleport";
import { setupTooltip } from "./ui/tooltip";

const SPLASHES = [
  "Now with Alaska!", "Also try Hawaii!", "100% real data!", "Not affiliated with Mojang!",
  "Contains no creepers!", "Biomes for everyone!", "Pixelated!", "Find the mushroom island!",
];

async function main() {
  // Point MapLibre at its bundled worker; its default lookup is relative to the (rebundled) module.
  maplibregl.setWorkerUrl(new URL(workerUrl, location.href).href);
  const base = import.meta.env.BASE_URL;
  const splash = document.getElementById("splash")!;
  splash.textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];

  const bg = dirtPattern(4);
  const c = document.createElement("canvas");
  c.width = bg.width;
  c.height = bg.height;
  c.getContext("2d")!.putImageData(bg, 0, 0);
  document.getElementById("map")!.style.backgroundImage = `url(${c.toDataURL()})`;

  const data = await loadBiomes(base);
  const tiles = new BiomeTiles(new URL(`${base}data/biomes.pmtiles`, location.href).href, data.byId, {
    hidden: new Set(),
    highlight: null,
    showVillages: true,
    shading: true,
    blocks: true,
  });
  maplibregl.addProtocol("biome", tiles.protocol);

  const initial = parseHash();
  const map = new maplibregl.Map({
    container: "map",
    center: initial ? [initial.lng, initial.lat] : [-98.5, 39.5],
    zoom: initial ? initial.zoom : 3.6,
    minZoom: 2,
    maxZoom: 16,
    renderWorldCopies: false,
    attributionControl: false,
    style: {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        biomes: {
          type: "raster",
          tiles: [tiles.tileUrl()],
          tileSize: 256,
          minzoom: 0,
          maxzoom: RENDER_MAX_ZOOM,
          attribution: "Land cover © ESA WorldCover 2021 · Climate WorldClim 2.1 · Elevation Mapzen/AWS Terrain Tiles · Natural Earth",
        },
        states: { type: "geojson", data: `${base}data/states.geojson` },
        cities: { type: "geojson", data: `${base}data/cities.geojson` },
      },
      layers: [
        {
          id: "biomes",
          type: "raster",
          source: "biomes",
          paint: { "raster-resampling": "nearest", "raster-fade-duration": 0 },
        },
        {
          id: "states",
          type: "line",
          source: "states",
          paint: { "line-color": "#1a1a1a", "line-opacity": 0.45, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 8, 1.6] },
        },
        {
          id: "city-dots",
          type: "circle",
          source: "cities",
          minzoom: 4,
          filter: ["<=", ["get", "rank"], 5],
          paint: { "circle-radius": 2.5, "circle-color": "#ffffff", "circle-stroke-color": "#3f3f3f", "circle-stroke-width": 1 },
        },
        {
          id: "cities",
          type: "symbol",
          source: "cities",
          minzoom: 4,
          layout: {
            "text-field": ["get", "name"],
            "text-font": ["Open Sans Semibold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 10, 15],
            "text-offset": [0, 0.9],
            "text-anchor": "top",
            "symbol-sort-key": ["get", "rank"],
          },
          paint: { "text-color": "#ffffff", "text-halo-color": "#3f3f3f", "text-halo-width": 1.5 },
        },
      ],
    },
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft." }), "bottom-right");
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-right");
  if (!initial) map.fitBounds([[-125, 24.3], [-66.9, 49.4]], { padding: 30, duration: 0 });

  const app = createApp(map, data, tiles);
  // Expose for debugging and automated checks.
  (window as unknown as { biomeMap: typeof app }).biomeMap = app;

  await map.once("load");
  const onTarget = setupF3(app);
  setupTooltip(app, onTarget);
  setupLegend(app);
  setupTeleport(app);
  setupShare(app);
  setupOptions(app);
  if (initial?.biome) applyBiome(app, initial.biome);
  chat("Welcome to BiomeMap! Hover to inspect biomes, press F3 for debug info.", "#ffff55");
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML("beforeend", `<div class="fatal">Failed to load the world: ${String(err)}</div>`);
});
