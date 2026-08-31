import { encode_png } from './png';

/*
 * Paint-by-number icons. Each icon carries a `pixels` grid of palette indices
 * and a `colors` lookup from index to an `[r, g, b, a]` byte tuple. Index 0 is
 * transparent (`[0, 0, 0, 0]`) by convention.
 *
 * Icons render as a single `image` element: `encode_icon` bakes the grid into a
 * PNG that is uploaded once as a device asset. A per-run rectangle strategy
 * exceeds the BUSY bar's element limit for detailed 16x16 art.
 *
 * Bootstrapped from source PNGs with RGB snapped to the nearest 32 and alpha
 * flattened to on/off.
 */

export type rgba = readonly [number, number, number, number];

const transparent: rgba = [0, 0, 0, 0];

export type icon = {
  width: number;
  height: number;
  colors: Record<number, rgba>;
  pixels: number[][];
};

export function encode_icon(icon: icon): Uint8Array {
  const { width, height, pixels, colors } = icon;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = pixels[y];
    for (let x = 0; x < width; x++) {
      const index = row?.[x] ?? 0;
      const [r, g, b, a] = colors[index] ?? transparent;
      const o = (y * width + x) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = a;
    }
  }
  return encode_png(width, height, rgba);
}

export const cat: icon = {
  width: 16,
  height: 16,
  colors: {
    0: [0, 0, 0, 0],
    1: [64, 64, 64, 255],
    2: [224, 160, 160, 255],
    3: [160, 160, 160, 255],
    4: [128, 96, 96, 255],
    5: [64, 192, 255, 255],
    6: [0, 0, 0, 255],
    7: [128, 128, 128, 255],
  },
  pixels: [
    [0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
    [0, 1, 2, 3, 1, 1, 1, 1, 1, 3, 2, 1, 0, 0, 0, 0],
    [0, 1, 2, 2, 4, 3, 4, 3, 4, 2, 2, 1, 0, 0, 0, 0],
    [0, 1, 3, 3, 4, 3, 3, 3, 4, 3, 3, 1, 0, 0, 0, 0],
    [0, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 1, 0, 0, 0, 0],
    [0, 1, 4, 3, 5, 3, 3, 3, 5, 3, 4, 1, 0, 0, 0, 0],
    [4, 4, 3, 3, 6, 3, 6, 3, 6, 3, 3, 4, 4, 0, 0, 0],
    [0, 1, 4, 3, 3, 3, 3, 3, 3, 3, 4, 1, 0, 0, 0, 0],
    [4, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 0, 0, 0],
    [0, 0, 1, 1, 3, 3, 3, 3, 3, 1, 1, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 3, 3, 3, 1, 0, 0, 0, 1, 1, 1, 0],
    [0, 0, 0, 0, 1, 3, 3, 3, 4, 1, 0, 1, 4, 4, 4, 1],
    [0, 0, 0, 0, 1, 3, 7, 3, 3, 4, 1, 3, 3, 4, 3, 1],
    [0, 0, 0, 0, 1, 7, 4, 7, 3, 3, 4, 3, 1, 1, 1, 0],
    [0, 0, 0, 0, 1, 3, 1, 3, 1, 3, 1, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0],
  ],
};

/*
 * Per-pet cat themes. A theme is a partial override of the cat palette, keyed by
 * (normalized) pet name; unspecified indices fall back to `cat.colors`.
 *
 * Cat palette slots:
 *   1 outline · 2 nose · 3 fur (light) · 4 shading · 5 eyes · 6 pupil · 7 fur (mid)
 * (0 is transparent and should not be themed.)
 */
export type icon_theme = Partial<Record<number, rgba>>;

export const cat_themes: Record<string, icon_theme> = {
  winky: {
    1: [128, 64, 0, 255],
    2: [224, 224, 192, 255],
    3: [192, 128, 96, 255],
    4: [192, 96, 32, 255],
    7: [192, 128, 64, 255],
  },
};

const normalize_pet_name = (name: string): string => name.trim().toLowerCase();

export function apply_theme(base: icon, theme: icon_theme | undefined): icon {
  if (theme === undefined) return base;
  const colors: Record<number, rgba> = { ...base.colors };
  for (const [index, color] of Object.entries(theme)) {
    if (color !== undefined) colors[Number(index)] = color;
  }
  return { ...base, colors };
}

export function cat_icon(pet_name: string | null): icon {
  const theme =
    pet_name === null ? undefined : cat_themes[normalize_pet_name(pet_name)];
  return apply_theme(cat, theme);
}

export type icon_asset = { path: string; data: Uint8Array };

/*
 * Asset paths are flat (no subdirectory). The device's upload handler only
 * creates a single directory level (`user_assets/<app>/`), so a nested path like
 * `icons/spotify.png` would fail to open for writing.
 */
export const spotify_path = 'spotify.png';

/*
 * The asset path is keyed by theme so each pet variant is a distinct file on the
 * device (e.g. `cat-winky.png`, else `cat.png`). Renderers reference this path;
 * the bytes are uploaded separately via `all_assets`.
 */
export function cat_path(pet_name: string | null): string {
  const key = pet_name === null ? null : normalize_pet_name(pet_name);
  const themed = key !== null && key in cat_themes;
  return `cat${themed ? `-${key}` : ''}.png`;
}

export function cat_asset(pet_name: string | null): icon_asset {
  return { path: cat_path(pet_name), data: encode_icon(cat_icon(pet_name)) };
}

export function spotify_asset(): icon_asset {
  return { path: spotify_path, data: encode_icon(spotify) };
}

/*
 * The full catalog of static device assets. Uploaded out-of-band (at device
 * registration and via manual refresh), not per draw.
 */
export function all_assets(): icon_asset[] {
  return [
    spotify_asset(),
    cat_asset(null),
    ...Object.keys(cat_themes).map((key) => cat_asset(key)),
  ];
}

export const spotify: icon = {
  width: 16,
  height: 16,
  colors: {
    0: [0, 0, 0, 0],
    1: [224, 255, 255, 255],
    2: [192, 224, 192, 255],
    3: [64, 192, 64, 255],
    4: [160, 192, 160, 255],
    5: [128, 192, 128, 255],
    6: [128, 224, 96, 255],
    7: [160, 255, 96, 255],
    8: [128, 224, 64, 255],
    9: [128, 224, 32, 255],
    10: [96, 224, 64, 255],
    11: [96, 192, 64, 255],
    12: [96, 192, 128, 255],
    13: [64, 160, 32, 255],
    14: [32, 32, 0, 255],
    15: [0, 0, 0, 255],
    16: [192, 192, 192, 255],
    17: [64, 160, 64, 255],
    18: [96, 160, 32, 255],
    19: [32, 128, 96, 255],
    20: [32, 64, 32, 255],
    21: [32, 96, 32, 255],
    22: [64, 128, 32, 255],
    23: [32, 96, 64, 255],
    24: [32, 64, 0, 255],
    25: [0, 32, 0, 255],
    26: [32, 96, 96, 255],
    27: [32, 128, 64, 255],
    28: [224, 224, 255, 255],
    29: [96, 128, 128, 255],
    30: [32, 160, 64, 255],
    31: [128, 160, 160, 255],
    32: [160, 192, 192, 255],
  },
  pixels: [
    [0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 2, 1, 0, 0, 0, 0],
    [0, 0, 0, 4, 5, 6, 7, 7, 7, 7, 6, 5, 4, 0, 0, 0],
    [0, 0, 2, 8, 9, 8, 8, 8, 8, 8, 8, 9, 8, 2, 0, 0],
    [0, 4, 8, 9, 10, 11, 11, 11, 11, 11, 11, 10, 9, 8, 4, 0],
    [1, 12, 8, 11, 13, 14, 15, 15, 15, 15, 14, 13, 11, 8, 12, 1],
    [16, 17, 18, 14, 15, 15, 13, 13, 13, 13, 15, 15, 14, 18, 17, 16],
    [19, 3, 11, 20, 21, 11, 22, 22, 22, 22, 11, 21, 20, 11, 3, 19],
    [23, 3, 11, 11, 13, 20, 15, 15, 15, 15, 20, 13, 11, 11, 3, 23],
    [23, 3, 11, 24, 25, 20, 22, 11, 11, 22, 20, 25, 24, 11, 3, 23],
    [26, 17, 11, 13, 13, 11, 13, 20, 20, 13, 11, 13, 13, 11, 17, 26],
    [16, 27, 11, 11, 13, 25, 15, 14, 14, 15, 25, 13, 11, 11, 27, 16],
    [28, 29, 30, 3, 15, 22, 18, 11, 11, 18, 22, 15, 11, 30, 29, 28],
    [0, 31, 27, 30, 30, 3, 11, 11, 11, 11, 3, 30, 30, 27, 31, 0],
    [0, 0, 32, 27, 30, 30, 30, 30, 30, 30, 30, 30, 27, 32, 0, 0],
    [0, 0, 0, 31, 29, 27, 30, 30, 30, 30, 27, 29, 31, 0, 0, 0],
    [0, 0, 0, 0, 28, 16, 26, 23, 23, 26, 16, 28, 0, 0, 0, 0],
  ],
};
