import type { App } from "../state";
import { chat } from "./chat";

export interface ViewState {
  lat: number;
  lng: number;
  zoom: number;
  biome?: string;
}

/** Parse "#lat,lng,zoom[,biome_key]". */
export function parseHash(hash = location.hash): ViewState | null {
  const parts = hash.replace(/^#/, "").split(",");
  if (parts.length < 3) return null;
  const [lat, lng, zoom] = parts.slice(0, 3).map(Number);
  if (![lat, lng, zoom].every(Number.isFinite)) return null;
  return { lat, lng, zoom, biome: parts[3] || undefined };
}

export function formatHash(v: ViewState): string {
  return `#${v.lat.toFixed(4)},${v.lng.toFixed(4)},${v.zoom.toFixed(2)}${v.biome ? `,${v.biome}` : ""}`;
}

/** Keep the URL hash in sync with the view + highlighted biome, and handle "Copy link". */
export function setupShare(app: App): void {
  const { map, data, tiles } = app;

  const current = (): ViewState => {
    const c = map.getCenter();
    const h = tiles.options.highlight;
    return { lat: c.lat, lng: c.lng, zoom: map.getZoom(), biome: h !== null ? data.byId[h]?.key : undefined };
  };
  const write = () => history.replaceState(null, "", formatHash(current()));
  map.on("moveend", write);
  app.onChange(write);

  window.addEventListener("hashchange", () => {
    const v = parseHash();
    if (!v) return;
    applyBiome(app, v.biome);
    map.jumpTo({ center: [v.lng, v.lat], zoom: v.zoom });
  });

  document.getElementById("btn-share")!.addEventListener("click", async () => {
    write();
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      chat("Link copied to clipboard!", "#55ff55");
    } catch {
      chat(url, "#aaaaaa");
    }
  });
}

export function applyBiome(app: App, key: string | undefined): void {
  const b = key ? app.data.byKey.get(key) : undefined;
  const next = b ? b.id : null;
  if (app.tiles.options.highlight !== next) {
    app.tiles.options.highlight = next;
    app.emitChange();
  }
}
