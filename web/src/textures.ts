import type { Biome, TextureKind } from "./biomes";

/**
 * Procedurally generated 16x16 "block" textures. They are original, not copied from Minecraft.
 * Each texel is either a brightness multiplier applied to the biome color, or an
 * absolute override color (used for flowers, terracotta strata, etc).
 */
export interface BlockTexture {
  mul: Float32Array; // 256 multipliers
  over: Uint8ClampedArray; // 256 * 4 RGBA; alpha > 0 means override
}

const SIZE = 16;

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function make(kind: TextureKind): BlockTexture {
  const mul = new Float32Array(SIZE * SIZE).fill(1);
  const over = new Uint8ClampedArray(SIZE * SIZE * 4);
  const seed = [...kind].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) & 0xffff;
  const set = (x: number, y: number, c: string) => {
    const i = ((y & 15) * SIZE + (x & 15)) * 4;
    const [r, g, b] = hex(c);
    over[i] = r; over[i + 1] = g; over[i + 2] = b; over[i + 3] = 255;
  };
  const n = (x: number, y: number, s = 0) => hash(x, y, seed + s);
  const each = (fn: (x: number, y: number, i: number) => void) => {
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) fn(x, y, y * SIZE + x);
  };
  const leaves = (dark: number, bright: number) =>
    each((x, y, i) => {
      const v = n(x >> 1, y >> 1, 3) * 0.6 + n(x, y) * 0.4;
      mul[i] = v < 0.18 ? dark : 0.8 + v * (bright - 0.8);
    });

  switch (kind) {
    case "water":
    case "deep_water":
    case "warm_water":
      each((x, y, i) => {
        const wave = Math.sin((x + y * 0.5) * 0.8 + n(0, y) * 4) * 0.5 + 0.5;
        mul[i] = 0.88 + wave * 0.14 + n(x, y) * 0.05 + (kind === "warm_water" ? 0.08 : 0);
      });
      break;
    case "ice":
    case "packed_ice":
      each((x, y, i) => {
        mul[i] = 0.92 + n(x, y) * 0.08 + ((x + y) % 7 === 0 ? 0.12 : 0);
        if (kind === "packed_ice" && (x % 8 === 0 || y % 8 === 0) && n(x, y, 2) > 0.4) mul[i] = 0.82;
      });
      break;
    case "snow":
      each((x, y, i) => { mul[i] = 0.95 + n(x, y) * 0.05; if (n(x, y, 1) > 0.94) set(x, y, "#dfe8f2"); });
      break;
    case "snow_sand":
      each((x, y, i) => { mul[i] = 0.94 + n(x, y) * 0.07; if (n(x >> 1, y >> 1, 4) > 0.7) set(x, y, "#f4f8fb"); });
      break;
    case "snow_stone":
      each((x, y, i) => {
        mul[i] = 0.93 + n(x, y) * 0.08;
        if (n(x >> 1, y >> 1, 5) > 0.62) set(x, y, n(x, y, 6) > 0.5 ? "#7f7f7f" : "#6c6c6c");
      });
      break;
    case "sand":
      each((x, y, i) => { mul[i] = 0.9 + n(x, y) * 0.14; if (n(x, y, 1) > 0.95) mul[i] = 1.12; });
      break;
    case "terracotta": {
      const bands = ["#d1793e", "#a54d26", "#e6c9ae", "#975a3c", "#c48a45", "#8e3b28", "#b5653b"];
      each((x, y, i) => {
        const band = Math.floor((y + (n(x >> 2, 0, 7) > 0.7 ? 1 : 0)) / 2.3);
        set(x, y, bands[band % bands.length]);
        mul[i] = 0.92 + n(x, y) * 0.1;
      });
      break;
    }
    case "coarse_dirt":
      each((x, y, i) => {
        const v = n(x >> 1, y >> 1);
        mul[i] = 0.72 + v * 0.38;
        if (v > 0.85) set(x, y, "#6b4c33");
      });
      break;
    case "dry_grass":
      each((x, y, i) => { mul[i] = 0.86 + n(x, y) * 0.22; if (n(x, y, 2) > 0.9) set(x, y, "#a68c4f"); });
      break;
    case "grass":
      each((x, y, i) => { mul[i] = 0.84 + n(x, y) * 0.24; if (n(x, y, 2) > 0.93) mul[i] = 0.7; });
      break;
    case "sunflower":
      each((x, y, i) => { mul[i] = 0.84 + n(x, y) * 0.24; });
      for (const [cx, cy] of [[3, 3], [11, 6], [6, 12]]) {
        set(cx, cy, "#f6d32b"); set(cx + 1, cy, "#f6d32b"); set(cx, cy + 1, "#f6d32b"); set(cx + 1, cy + 1, "#7a4b17");
        set(cx - 1, cy, "#f2c218"); set(cx + 2, cy + 1, "#f2c218"); set(cx, cy - 1, "#f2c218"); set(cx + 1, cy + 2, "#f2c218");
      }
      break;
    case "flowers": {
      const colors = ["#e3312d", "#f6e22b", "#5b8ff0", "#f4f4f4", "#ee7fd0", "#f39a2b", "#b04fe0"];
      each((x, y, i) => {
        mul[i] = 0.84 + n(x, y) * 0.22;
        if (n(x, y, 9) > 0.92) set(x, y, colors[Math.floor(n(x, y, 10) * colors.length)]);
      });
      break;
    }
    case "leaves":
      leaves(0.55, 1.12);
      break;
    case "birch":
      leaves(0.65, 1.2);
      each((x, y) => { if (n(x, y, 11) > 0.96) set(x, y, "#e8e6dc"); });
      break;
    case "dark_leaves":
      leaves(0.42, 0.98);
      break;
    case "spruce":
      leaves(0.5, 1.05);
      each((x, y, i) => { if ((x + (y >> 1)) % 5 === 0) mul[i] *= 0.82; });
      break;
    case "snowy_spruce":
      leaves(0.55, 1.05);
      each((x, y) => { if (n(x >> 1, y >> 1, 12) > 0.6 || n(x, y, 13) > 0.9) set(x, y, n(x, y, 14) > 0.5 ? "#f2f6f8" : "#dde7ee"); });
      break;
    case "podzol":
      leaves(0.55, 1.1);
      each((x, y) => { if (n(x >> 1, y >> 1, 15) > 0.78) set(x, y, n(x, y, 16) > 0.5 ? "#7a5a2c" : "#5c4120"); });
      break;
    case "jungle":
      leaves(0.5, 1.2);
      each((x, y) => { if (n(x, y, 17) > 0.97) set(x, y, "#a85a1e"); });
      break;
    case "bamboo":
      each((x, y, i) => {
        const stalk = (x + (n(0, y >> 2, 18) > 0.5 ? 1 : 0)) % 4;
        mul[i] = stalk === 0 ? 0.65 : stalk === 1 ? 1.15 : 0.92 + n(x, y) * 0.12;
        if (stalk === 1 && y % 5 === 0) mul[i] = 0.8;
      });
      break;
    case "swamp":
      each((x, y, i) => {
        mul[i] = 0.55 + n(x >> 1, y >> 1) * 0.3;
        if (n(x >> 1, y >> 1, 19) > 0.8) set(x, y, "#3f6b25");
      });
      break;
    case "mud":
      each((x, y, i) => {
        set(x, y, n(x, y) > 0.5 ? "#3c3237" : "#463a3f");
        mul[i] = 1;
        if (n(x >> 1, y >> 1, 20) > 0.62) { set(x, y, n(x, y, 21) > 0.4 ? "#4a7a28" : "#386020"); }
        if ((x * 3 + y) % 11 === 0 && n(x, y, 22) > 0.5) set(x, y, "#6e4a2c");
      });
      break;
    case "stone":
      each((x, y, i) => {
        mul[i] = 0.86 + n(x, y) * 0.18;
        if (n(x >> 1, y, 23) > 0.9) mul[i] = 0.68;
      });
      break;
    case "stone_grass":
      each((x, y, i) => {
        const g = n(x >> 2, y >> 2, 24) > 0.55;
        if (g) set(x, y, n(x, y) > 0.5 ? "#6f9a48" : "#5f8a3c");
        else mul[i] = 0.88 + n(x, y) * 0.2;
      });
      break;
    case "gravel":
      each((x, y, i) => { const v = n(x, y); mul[i] = v < 0.3 ? 0.62 : v > 0.85 ? 1.25 : 0.9 + v * 0.1; });
      break;
    case "mycelium":
      each((x, y) => {
        const v = n(x, y);
        set(x, y, v > 0.82 ? "#968a96" : v > 0.4 ? "#6f6268" : "#5f5359");
      });
      set(4, 5, "#c2262e"); set(5, 5, "#c2262e"); set(4, 4, "#e2e2e2");
      set(11, 11, "#c2262e"); set(12, 11, "#c2262e"); set(12, 10, "#e2e2e2");
      break;
  }
  return { mul, over };
}

const cache = new Map<TextureKind, BlockTexture>();

export function getTexture(kind: TextureKind): BlockTexture {
  let t = cache.get(kind);
  if (!t) {
    t = make(kind);
    cache.set(kind, t);
  }
  return t;
}

const VILLAGE: BlockTexture = (() => {
  const mul = new Float32Array(SIZE * SIZE).fill(1);
  const over = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      // Dirt-path cross with two little houses (planks + cobblestone roofs).
      let c: [number, number, number] | null = null;
      if (x === 7 || x === 8 || y === 7 || y === 8) c = [148, 121, 75];
      else if (x >= 2 && x <= 5 && y >= 2 && y <= 5) c = (x + y) % 2 ? [158, 116, 70] : [138, 100, 60];
      else if (x >= 10 && x <= 13 && y >= 10 && y <= 13) c = hash(x, y, 99) > 0.5 ? [122, 122, 122] : [96, 96, 96];
      else if (x >= 10 && x <= 13 && y >= 2 && y <= 4) c = [176, 90, 60];
      if (c) { over[i] = c[0]; over[i + 1] = c[1]; over[i + 2] = c[2]; over[i + 3] = 255; }
    }
  }
  return { mul, over };
})();

export function villageTexture(): BlockTexture {
  return VILLAGE;
}

/** Render a biome's block texture as a data URL icon. */
export function biomeIcon(b: Biome, scale = 2): string {
  const t = getTexture(b.texture);
  const c = document.createElement("canvas");
  c.width = c.height = SIZE * scale;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const o = i * 4;
    if (t.over[o + 3]) {
      img.data[o] = t.over[o]; img.data[o + 1] = t.over[o + 1]; img.data[o + 2] = t.over[o + 2];
    } else {
      img.data[o] = b.rgb[0] * t.mul[i]; img.data[o + 1] = b.rgb[1] * t.mul[i]; img.data[o + 2] = b.rgb[2] * t.mul[i];
    }
    img.data[o + 3] = 255;
  }
  const tmp = document.createElement("canvas");
  tmp.width = tmp.height = SIZE;
  tmp.getContext("2d")!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, SIZE * scale, SIZE * scale);
  return c.toDataURL();
}

/** A dark dirt pattern for the map background (like the options screen). */
export function dirtPattern(scale = 4): ImageData {
  const size = SIZE * scale;
  const img = new ImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = hash(Math.floor(x / scale), Math.floor(y / scale), 4242);
      const base = v > 0.8 ? [58, 42, 30] : v > 0.4 ? [45, 33, 24] : [36, 27, 20];
      const o = (y * size + x) * 4;
      img.data[o] = base[0]; img.data[o + 1] = base[1]; img.data[o + 2] = base[2]; img.data[o + 3] = 255;
    }
  }
  return img;
}

export { hash };
