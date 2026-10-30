import type { App } from "../state";
import { biomeIcon } from "../textures";

/** Biome legend with show/hide toggles and click-to-highlight. */
export function setupLegend(app: App): void {
  const { data, tiles } = app;
  const opts = tiles.options;
  const panel = document.getElementById("legend")!;
  const list = panel.querySelector<HTMLElement>(".legend-list")!;
  const present = data.biomes.filter((b) => b.pixels > 0).sort((a, b) => b.area_km2 - a.area_km2);
  const total = present.reduce((s, b) => s + b.area_km2, 0);

  for (const b of present) {
    const row = document.createElement("div");
    row.className = "legend-row";
    row.dataset.id = String(b.id);
    const pct = (b.area_km2 / total) * 100;
    row.innerHTML = `
      <button class="mc-check" title="Show / hide"></button>
      <img src="${biomeIcon(b, 1)}" alt="" />
      <button class="legend-name" title="Highlight ${b.name}">${b.name}</button>
      <span class="legend-pct">${pct >= 0.1 ? pct.toFixed(1) : "<0.1"}%</span>`;
    row.querySelector<HTMLButtonElement>(".mc-check")!.onclick = () => {
      if (opts.hidden.has(b.id)) opts.hidden.delete(b.id);
      else opts.hidden.add(b.id);
      app.emitChange();
    };
    row.querySelector<HTMLButtonElement>(".legend-name")!.onclick = () => {
      opts.highlight = opts.highlight === b.id ? null : b.id;
      if (opts.highlight !== null) opts.hidden.delete(b.id);
      app.emitChange();
    };
    list.appendChild(row);
  }

  const villageRow = document.createElement("div");
  villageRow.className = "legend-row village";
  villageRow.innerHTML = `<button class="mc-check" title="Show / hide villages"></button><span class="village-swatch"></span><span class="legend-name static">Villages (cities)</span>`;
  villageRow.querySelector<HTMLButtonElement>(".mc-check")!.onclick = () => {
    opts.showVillages = !opts.showVillages;
    app.emitChange();
  };
  list.prepend(villageRow);

  panel.querySelector<HTMLButtonElement>("[data-act=all]")!.onclick = () => {
    opts.hidden.clear();
    opts.highlight = null;
    app.emitChange();
  };
  panel.querySelector<HTMLButtonElement>("[data-act=none]")!.onclick = () => {
    for (const b of present) opts.hidden.add(b.id);
    opts.highlight = null;
    app.emitChange();
  };
  panel.querySelector<HTMLButtonElement>("[data-act=toggle]")!.onclick = () => panel.classList.toggle("collapsed");

  const sync = () => {
    for (const row of list.querySelectorAll<HTMLElement>(".legend-row[data-id]")) {
      const id = Number(row.dataset.id);
      row.classList.toggle("off", opts.hidden.has(id));
      row.classList.toggle("hl", opts.highlight === id);
    }
    villageRow.classList.toggle("off", !opts.showVillages);
  };
  app.onChange(sync);
  sync();
}
