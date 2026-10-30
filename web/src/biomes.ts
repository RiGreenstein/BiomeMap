export type TextureKind =
  | "water" | "deep_water" | "warm_water" | "ice" | "packed_ice" | "snow" | "snow_sand" | "snow_stone"
  | "sand" | "terracotta" | "coarse_dirt" | "dry_grass" | "grass" | "sunflower" | "flowers"
  | "leaves" | "birch" | "dark_leaves" | "spruce" | "snowy_spruce" | "podzol" | "jungle" | "bamboo"
  | "swamp" | "mud" | "stone" | "stone_grass" | "gravel" | "mycelium";

export interface Biome {
  id: number;
  key: string;
  name: string;
  color: string;
  texture: TextureKind;
  temp: string;
  description: string;
  pixels: number;
  area_km2: number;
  rgb: [number, number, number];
}

export type Samples = Record<string, [number, number][]>;

export interface BiomeData {
  biomes: Biome[];
  byId: (Biome | undefined)[];
  byKey: Map<string, Biome>;
  samples: Samples;
}

export const VILLAGE_BIT = 0x80;
export const ELEV_OFFSET = 12000;
export const DATA_ZOOM = 8;

export function isWater(b: Biome): boolean {
  return b.key.includes("ocean") || b.key.includes("river");
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export async function loadBiomes(base: string): Promise<BiomeData> {
  const [catalog, samples] = await Promise.all([
    fetch(`${base}data/biomes.json`).then((r) => r.json()),
    fetch(`${base}data/samples.json`).then((r) => r.json()),
  ]);
  const biomes: Biome[] = catalog.map((b: Omit<Biome, "rgb">) => ({ ...b, rgb: hexToRgb(b.color) }));
  const byId: (Biome | undefined)[] = [];
  const byKey = new Map<string, Biome>();
  for (const b of biomes) {
    byId[b.id] = b;
    byKey.set(b.key, b);
  }
  return { biomes, byId, byKey, samples };
}
