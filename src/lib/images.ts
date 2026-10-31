import data from '../data/images.json';

export type ImageKey = keyof typeof data;
export type ImageInfo = {
  key: string;
  alt: string;
  width: number;
  height: number;
  widths: number[];
  lqip: string;
  color: string;
};

export const images = data as Record<ImageKey, ImageInfo>;

export function srcFor(key: ImageKey, target = 1280) {
  const info = images[key];
  const w = info.widths.find((x) => x >= target) ?? info.widths[info.widths.length - 1];
  return `/img/${key}-${w}.webp`;
}

export function srcSetFor(key: ImageKey) {
  return images[key].widths.map((w) => `/img/${key}-${w}.webp ${w}w`).join(', ');
}
