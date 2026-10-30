import type { Map as MLMap, RasterTileSource } from "maplibre-gl";
import type { BiomeData } from "./biomes";
import type { BiomeTiles } from "./tiles";

/** Shared app context passed to UI modules. */
export interface App {
  map: MLMap;
  data: BiomeData;
  tiles: BiomeTiles;
  /** Re-render biome tiles after a render option changed. */
  refresh(): void;
  /** Subscribe to render-option changes (filters, highlight). */
  onChange(fn: () => void): void;
  emitChange(): void;
}

export function createApp(map: MLMap, data: BiomeData, tiles: BiomeTiles): App {
  const listeners: (() => void)[] = [];
  let pending = false;
  const app: App = {
    map,
    data,
    tiles,
    refresh() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        tiles.version++;
        const src = map.getSource("biomes") as RasterTileSource | undefined;
        src?.setTiles([tiles.tileUrl()]);
      });
    },
    onChange(fn) {
      listeners.push(fn);
    },
    emitChange() {
      app.refresh();
      for (const fn of listeners) fn();
    },
  };
  return app;
}
