import type { App } from "../state";

/** Minecraft "Options" style toggle buttons and region quick-jumps. */
export function setupOptions(app: App): void {
  const { map, tiles } = app;
  const opts = tiles.options;

  const toggles: { id: string; label: string; get: () => boolean; set: (v: boolean) => void }[] = [
    { id: "opt-shading", label: "Terrain", get: () => opts.shading, set: (v) => { opts.shading = v; app.emitChange(); } },
    { id: "opt-blocks", label: "Block Textures", get: () => opts.blocks, set: (v) => { opts.blocks = v; app.emitChange(); } },
    {
      id: "opt-borders", label: "State Borders",
      get: () => map.getLayoutProperty("states", "visibility") !== "none",
      set: (v) => map.setLayoutProperty("states", "visibility", v ? "visible" : "none"),
    },
    {
      id: "opt-cities", label: "Cities",
      get: () => map.getLayoutProperty("cities", "visibility") !== "none",
      set: (v) => {
        map.setLayoutProperty("cities", "visibility", v ? "visible" : "none");
        map.setLayoutProperty("city-dots", "visibility", v ? "visible" : "none");
      },
    },
  ];
  for (const t of toggles) {
    const btn = document.getElementById(t.id) as HTMLButtonElement;
    const label = () => (btn.textContent = `${t.label}: ${t.get() ? "ON" : "OFF"}`);
    btn.onclick = () => {
      t.set(!t.get());
      label();
    };
    label();
  }

  const jumps: Record<string, [[number, number], [number, number]]> = {
    "jump-conus": [[-125, 24.3], [-66.9, 49.4]],
    "jump-alaska": [[-170, 51.5], [-130, 71.5]],
    "jump-hawaii": [[-160.3, 18.9], [-154.8, 22.3]],
  };
  for (const [id, bounds] of Object.entries(jumps)) {
    document.getElementById(id)!.onclick = () => map.fitBounds(bounds, { padding: 40, duration: 1200 });
  }
  document.getElementById("btn-options")!.onclick = () =>
    document.getElementById("options")!.classList.toggle("open");
}
