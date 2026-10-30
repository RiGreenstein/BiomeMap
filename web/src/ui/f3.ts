import type { LngLat } from "maplibre-gl";
import type { App } from "../state";
import type { PointInfo } from "../tiles";

const DIRS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

/** F3-style debug readout. Toggle with the F3 key or the button. */
export function setupF3(app: App): (lngLat: LngLat | null, info: PointInfo | null) => void {
  const { map, tiles } = app;
  const el = document.getElementById("f3")!;
  let target: { lngLat: LngLat; info: PointInfo | null } | null = null;
  let center: PointInfo | null = null;
  let fps = 0, frames = 0, last = performance.now();

  const loop = (t: number) => {
    frames++;
    if (t - last >= 1000) {
      fps = Math.round((frames * 1000) / (t - last));
      frames = 0;
      last = t;
      if (!el.hidden) render();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const updateCenter = async () => {
    const c = map.getCenter();
    center = await tiles.lookup(c.lng, c.lat);
    render();
  };
  map.on("moveend", updateCenter);
  map.once("idle", updateCenter);

  const blockXYZ = (lngLat: LngLat, elev: number | undefined) => {
    // Web Mercator meters, so 1 "block" = 1 meter east (X) / south (Z).
    const x = Math.round((lngLat.lng * 20037508.34) / 180);
    const s = Math.sin((lngLat.lat * Math.PI) / 180);
    const z = Math.round(-(Math.log((1 + s) / (1 - s)) / 2) * 6378137);
    return { x, y: elev ?? 0, z };
  };

  const line = (label: string, value: string) => `<div><span class="k">${label}</span> ${value}</div>`;

  const render = () => {
    const c = map.getCenter();
    const pos = blockXYZ(c, center?.elevation);
    const bearing = ((map.getBearing() % 360) + 360) % 360;
    const zoom = map.getZoom();
    const metersPerPx = (156543.03392 * Math.cos((c.lat * Math.PI) / 180)) / 2 ** zoom;
    const blockM = (156543.03392 * Math.cos((c.lat * Math.PI) / 180)) / 2 ** 8;
    const left = [
      `<div>BiomeMap 1.0 (vanilla/US)</div>`,
      `<div>${fps} fps T: inf vsync ${tiles.options.blocks ? "blocks" : "flat"}</div>`,
      `<br/>`,
      line("XYZ:", `${pos.x} / ${pos.y} / ${pos.z}`),
      line("Lat/Lon:", `${c.lat.toFixed(5)} / ${c.lng.toFixed(5)}`),
      line("Chunk:", `${Math.floor(pos.x / 16)} ${Math.floor(pos.z / 16)}`),
      line("Facing:", `${DIRS[Math.round(bearing / 45) % 8]} (${bearing.toFixed(1)})`),
      line("Biome:", center ? `minecraft:${center.biome.key}` : "minecraft:the_void"),
      line("Zoom:", `${zoom.toFixed(2)} (${metersPerPx.toFixed(1)} m/px, block ${blockM.toFixed(0)} m)`),
    ];
    if (target) {
      const t = blockXYZ(target.lngLat, target.info?.elevation);
      left.push(`<br/>`, `<div class="u">Targeted Block: ${t.x}, ${t.y}, ${t.z}</div>`);
      left.push(line("Biome:", target.info ? `minecraft:${target.info.biome.key}` : "minecraft:the_void"));
      if (target.info) {
        left.push(line("Temperature:", target.info.biome.temp));
        if (target.info.village) left.push(line("Structure:", "minecraft:village"));
      }
    }
    el.innerHTML = left.join("");
  };

  const toggle = () => {
    el.hidden = !el.hidden;
    if (!el.hidden) render();
  };
  window.addEventListener("keydown", (e) => {
    if (e.key === "F3") {
      e.preventDefault();
      toggle();
    }
  });
  document.getElementById("btn-f3")?.addEventListener("click", toggle);

  return (lngLat, info) => {
    target = lngLat ? { lngLat, info } : null;
    if (!el.hidden) render();
  };
}
