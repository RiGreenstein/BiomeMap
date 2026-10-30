import type { App } from "../state";
import { chat } from "./chat";

/** Random "/tp" to a land location, optionally restricted to one biome. */
export function setupTeleport(app: App): void {
  const { map, data, tiles } = app;
  const select = document.getElementById("tp-biome") as HTMLSelectElement;
  const button = document.getElementById("btn-tp") as HTMLButtonElement;

  const withSamples = data.biomes
    .filter((b) => (data.samples[String(b.id)]?.length ?? 0) > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  select.innerHTML = `<option value="">Any land biome</option>` +
    withSamples.map((b) => `<option value="${b.id}">${b.name}</option>`).join("");

  // Follow the legend highlight so "highlight + teleport" explores one biome.
  app.onChange(() => {
    const h = tiles.options.highlight;
    if (h !== null && withSamples.some((b) => b.id === h)) select.value = String(h);
  });

  const isLand = (key: string) => !key.includes("ocean") && !key.includes("river");

  button.onclick = () => {
    const chosen = select.value ? [Number(select.value)] : withSamples.filter((b) => isLand(b.key)).map((b) => b.id);
    // Weight "any" by area so common biomes come up more often, but still sample rare ones.
    const weights = chosen.map((id) => Math.sqrt(data.byId[id]!.area_km2 + 1));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    let pick = chosen[0];
    for (let i = 0; i < chosen.length; i++) {
      r -= weights[i];
      if (r <= 0) { pick = chosen[i]; break; }
    }
    const pts = data.samples[String(pick)];
    const [lng, lat] = pts[Math.floor(Math.random() * pts.length)];
    const biome = data.byId[pick]!;
    map.flyTo({ center: [lng, lat], zoom: 10.5, speed: 1.6, essential: true });
    chat(`Teleported to ${biome.name} at ${lat.toFixed(4)}, ${lng.toFixed(4)}`, "#ffff55");
  };
}
