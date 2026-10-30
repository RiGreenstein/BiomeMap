import { decode } from "fast-png";
import { PMTiles } from "pmtiles";
import type { AddProtocolAction } from "maplibre-gl";
import { DATA_ZOOM, ELEV_OFFSET, VILLAGE_BIT, isWater, type Biome } from "./biomes";
import { getTexture, hash, villageTexture, type BlockTexture } from "./textures";

const TILE = 256;
const MAX_RENDER_ZOOM = 12; // 16 px per block at z12
const CACHE_LIMIT = 384;

/** Decoded data tile: raw RGBA from the PMTiles archive. */
type DataTile = Uint8Array | null;

export interface RenderOptions {
  hidden: Set<number>;
  highlight: number | null;
  showVillages: boolean;
  shading: boolean;
  blocks: boolean;
}

export interface PointInfo {
  biome: Biome;
  village: boolean;
  elevation: number;
}

export class BiomeTiles {
  private archive: PMTiles;
  private cache = new Map<string, Promise<DataTile>>();
  private textures: (BlockTexture | undefined)[] = [];
  version = 0;

  constructor(url: string, private byId: (Biome | undefined)[], public options: RenderOptions) {
    this.archive = new PMTiles(url);
    for (const b of byId) if (b) this.textures[b.id] = getTexture(b.texture);
  }

  /** Fetch and decode a data tile (z <= DATA_ZOOM), with a small LRU cache. */
  getData(z: number, x: number, y: number): Promise<DataTile> {
    const key = `${z}/${x}/${y}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const p = this.archive.getZxy(z, x, y).then((res) => {
      if (!res?.data) return null;
      const img = decode(new Uint8Array(res.data));
      if (img.channels === 4) return img.data as Uint8Array;
      // Expand RGB to RGBA if the encoder ever drops alpha.
      const out = new Uint8Array(TILE * TILE * 4);
      for (let i = 0, j = 0; i < out.length; i += 4, j += img.channels) {
        out[i] = img.data[j]; out[i + 1] = img.data[j + 1]; out[i + 2] = img.data[j + 2]; out[i + 3] = 255;
      }
      return out;
    }).catch(() => null);
    this.cache.set(key, p);
    if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    return p;
  }

  /** Look up the biome at a coordinate using the full-resolution data tiles. */
  async lookup(lng: number, lat: number): Promise<PointInfo | null> {
    if (lat > 85 || lat < -85) return null;
    const world = TILE * 2 ** DATA_ZOOM;
    const gx = Math.floor(((lng + 180) / 360) * world);
    const s = Math.sin((lat * Math.PI) / 180);
    const gy = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world);
    const tx = Math.floor(gx / TILE), ty = Math.floor(gy / TILE);
    const data = await this.getData(DATA_ZOOM, tx, ty);
    if (!data) return null;
    const o = ((gy - ty * TILE) * TILE + (gx - tx * TILE)) * 4;
    if (data[o + 3] === 0) return null;
    const biome = this.byId[data[o] & 0x7f];
    if (!biome) return null;
    return {
      biome,
      village: (data[o] & VILLAGE_BIT) !== 0,
      elevation: data[o + 1] * 256 + data[o + 2] - ELEV_OFFSET,
    };
  }

  /** MapLibre protocol handler for biome://{z}/{x}/{y} URLs. */
  protocol: AddProtocolAction = async (params) => {
    const m = /biome:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!m) throw new Error(`Bad biome URL ${params.url}`);
    const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const image = await this.render(z, x, y);
    return { data: await createImageBitmap(image) };
  };

  private async render(z: number, x: number, y: number): Promise<ImageData> {
    const out = new ImageData(TILE, TILE);
    const dz = Math.max(0, Math.min(z, MAX_RENDER_ZOOM) - DATA_ZOOM);
    const srcZ = Math.min(z, DATA_ZOOM);
    const div = 2 ** dz;
    const data = await this.getData(srcZ, Math.floor(x / div), Math.floor(y / div));
    if (!data) return out;

    const scale = div; // output pixels per data pixel
    const span = TILE / scale;
    const ox = (x % div) * span;
    const oy = (y % div) * span;

    const { hidden, highlight, showVillages, shading, blocks } = this.options;
    const useTex = blocks && scale >= 4;
    const tile = this.byId;
    // Ground meters per data pixel, for hillshade slope (latitude from tile center).
    const n = Math.PI - (2 * Math.PI * (y + 0.5)) / 2 ** z;
    const lat = Math.atan(Math.sinh(n));
    const metersPerPx = (156543.03392 * Math.cos(lat)) / 2 ** srcZ;
    const exaggeration = 2 + Math.max(0, 8 - srcZ) * 1.2;
    const gxBase = Math.floor(x / div) * TILE;
    const gyBase = Math.floor(y / div) * TILE;

    const elevAt = (px: number, py: number) => {
      const cx = px < 0 ? 0 : px > 255 ? 255 : px;
      const cy = py < 0 ? 0 : py > 255 ? 255 : py;
      const o = (cy * TILE + cx) * 4;
      return data[o + 1] * 256 + data[o + 2];
    };

    // Precompute per-data-pixel color for the visible span, then expand into blocks.
    for (let dy = 0; dy < span; dy++) {
      const sy = oy + dy;
      for (let dx = 0; dx < span; dx++) {
        const sx = ox + dx;
        const so = (sy * TILE + sx) * 4;
        if (data[so + 3] === 0) continue;
        const raw = data[so];
        const id = raw & 0x7f;
        const biome = tile[id];
        if (!biome || hidden.has(id)) continue;
        const village = showVillages && (raw & VILLAGE_BIT) !== 0;

        let r = biome.rgb[0], g = biome.rgb[1], b = biome.rgb[2];
        if (village && !useTex) {
          r = r * 0.5 + 150 * 0.5; g = g * 0.5 + 120 * 0.5; b = b * 0.5 + 80 * 0.5;
        }
        let shade = 1;
        const water = isWater(biome);
        if (shading && !water) {
          const ex = (elevAt(sx + 1, sy) - elevAt(sx - 1, sy)) / (2 * metersPerPx) * exaggeration;
          const ey = (elevAt(sx, sy + 1) - elevAt(sx, sy - 1)) / (2 * metersPerPx) * exaggeration;
          // Light from the north-west, like a low sun over the world.
          const lambert = (-ex * -0.5 + -ey * -0.5 + 0.7) / Math.sqrt(ex * ex + ey * ey + 1);
          shade = 0.55 + lambert * 0.65;
        } else if (water) {
          const depth = ELEV_OFFSET - elevAt(sx, sy);
          shade = depth > 0 ? Math.max(0.7, 1 - depth / 8000) : 1;
        }
        // Subtle per-block jitter gives the pixel-art look.
        shade *= 0.96 + hash(gxBase + sx, gyBase + sy, 1) * 0.08;
        if (highlight !== null && id !== highlight) {
          const l = (r + g + b) / 3;
          r = l * 0.35; g = l * 0.35; b = l * 0.35;
        }

        const tex = useTex ? (village ? villageTexture() : this.textures[id]) : undefined;
        for (let by = 0; by < scale; by++) {
          const py = dy * scale + by;
          const ty = useTex ? Math.floor((by * 16) / scale) : 0;
          for (let bx = 0; bx < scale; bx++) {
            const px = dx * scale + bx;
            const o = (py * TILE + px) * 4;
            let cr = r, cg = g, cb = b;
            if (tex) {
              const t = ty * 16 + Math.floor((bx * 16) / scale);
              if (tex.over[t * 4 + 3]) {
                cr = tex.over[t * 4]; cg = tex.over[t * 4 + 1]; cb = tex.over[t * 4 + 2];
                if (highlight !== null && id !== highlight) {
                  const l = (cr + cg + cb) / 3 * 0.35;
                  cr = cg = cb = l;
                }
              } else {
                cr *= tex.mul[t]; cg *= tex.mul[t]; cb *= tex.mul[t];
              }
            }
            out.data[o] = cr * shade;
            out.data[o + 1] = cg * shade;
            out.data[o + 2] = cb * shade;
            out.data[o + 3] = 255;
          }
        }
      }
    }
    // Block grid lines at high zoom.
    if (useTex && scale >= 8) {
      for (let py = 0; py < TILE; py++) {
        for (let px = 0; px < TILE; px++) {
          if (px % scale !== 0 && py % scale !== 0) continue;
          const o = (py * TILE + px) * 4;
          if (out.data[o + 3]) {
            out.data[o] *= 0.82; out.data[o + 1] *= 0.82; out.data[o + 2] *= 0.82;
          }
        }
      }
    }
    return out;
  }

  /** Bump the version so MapLibre refetches tiles after a style option changes. */
  tileUrl(): string {
    return `biome://{z}/{x}/{y}?v=${this.version}`;
  }
}

export const RENDER_MAX_ZOOM = MAX_RENDER_ZOOM;
