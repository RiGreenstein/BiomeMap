import type { LngLat, MapMouseEvent } from "maplibre-gl";
import type { App } from "../state";
import type { PointInfo } from "../tiles";
import { biomeIcon } from "../textures";

export type HoverListener = (lngLat: LngLat | null, info: PointInfo | null) => void;

/** Hover tooltip plus click-to-pin, styled like a Minecraft item tooltip. */
export function setupTooltip(app: App, onHover: HoverListener): void {
  const { map, tiles } = app;
  const hover = document.getElementById("tooltip")!;
  const pinned = document.getElementById("pinned")!;
  const icons = new Map<number, string>();
  let pinnedAt: LngLat | null = null;
  let seq = 0;

  const html = (info: PointInfo, lngLat: LngLat) => {
    const b = info.biome;
    if (!icons.has(b.id)) icons.set(b.id, biomeIcon(b, 2));
    return `
      <div class="tt-title"><img src="${icons.get(b.id)}" alt="" /><span>${b.name}</span></div>
      <div class="tt-id">minecraft:${b.key}</div>
      <div class="tt-desc">${b.description}</div>
      <div class="tt-stat"><span>Temperature:</span> ${b.temp}</div>
      <div class="tt-stat"><span>Elevation:</span> ${info.elevation.toLocaleString()} m</div>
      ${info.village ? `<div class="tt-village">Village (built-up area)</div>` : ""}
      <div class="tt-coords">${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}</div>`;
  };

  const place = (el: HTMLElement, x: number, y: number) => {
    const w = el.offsetWidth, h = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    el.style.left = `${Math.min(x + 16, vw - w - 8)}px`;
    el.style.top = `${Math.max(8, Math.min(y - h - 12, vh - h - 8))}px`;
  };

  let frame = 0;
  let lastEvent: MapMouseEvent | null = null;
  map.on("mousemove", (e) => {
    lastEvent = e;
    if (frame) return;
    frame = requestAnimationFrame(async () => {
      frame = 0;
      const ev = lastEvent!;
      const id = ++seq;
      const info = await tiles.lookup(ev.lngLat.lng, ev.lngLat.lat);
      if (id !== seq) return;
      onHover(ev.lngLat, info);
      if (!info) {
        hover.hidden = true;
        map.getCanvas().style.cursor = "";
        return;
      }
      map.getCanvas().style.cursor = "crosshair";
      hover.innerHTML = html(info, ev.lngLat);
      hover.hidden = false;
      place(hover, ev.originalEvent.clientX, ev.originalEvent.clientY);
    });
  });
  map.getCanvas().addEventListener("mouseleave", () => {
    seq++;
    hover.hidden = true;
    onHover(null, null);
  });

  const reposition = () => {
    if (!pinnedAt || pinned.hidden) return;
    const p = map.project(pinnedAt);
    const rect = map.getContainer().getBoundingClientRect();
    place(pinned, rect.left + p.x, rect.top + p.y);
  };

  map.on("click", async (e) => {
    const info = await tiles.lookup(e.lngLat.lng, e.lngLat.lat);
    if (!info) {
      pinned.hidden = true;
      pinnedAt = null;
      return;
    }
    pinnedAt = e.lngLat;
    pinned.innerHTML = `<button class="tt-close" title="Close">×</button>${html(info, e.lngLat)}`;
    pinned.hidden = false;
    pinned.querySelector<HTMLButtonElement>(".tt-close")!.onclick = () => {
      pinned.hidden = true;
      pinnedAt = null;
    };
    hover.hidden = true;
    reposition();
  });
  map.on("move", reposition);
}
