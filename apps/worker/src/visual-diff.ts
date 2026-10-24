import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

/**
 * Pixel comparison between two screenshots of the same journey checkpoint.
 *
 * Screenshots can differ in height (a section failed to render, content
 * reflowed). The overlapping region is compared pixel by pixel and every pixel
 * outside the overlap counts as changed, so a page that lost half its content
 * cannot look "unchanged".
 */

export interface VisualComparison {
  /** Changed pixels divided by the union area of both images. */
  diffRatio: number;
  diffPixels: number;
  unionPixels: number;
  overlap: { width: number; height: number };
  sizes: { a: { width: number; height: number }; b: { width: number; height: number } };
  /** PNG of the overlapping region with changed pixels highlighted. */
  diffPng: Buffer;
}

function crop(image: PNG, width: number, height: number): Buffer {
  if (image.width === width && image.height === height) return image.data;
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    image.data.copy(out, y * width * 4, y * image.width * 4, y * image.width * 4 + width * 4);
  }
  return out;
}

export function compareScreenshots(a: Buffer, b: Buffer): VisualComparison {
  const imageA = PNG.sync.read(a);
  const imageB = PNG.sync.read(b);
  const width = Math.min(imageA.width, imageB.width);
  const height = Math.min(imageA.height, imageB.height);
  const diff = new PNG({ width, height });
  const changed =
    width > 0 && height > 0
      ? pixelmatch(crop(imageA, width, height), crop(imageB, width, height), diff.data, width, height, {
          // Per-pixel color tolerance (YIQ distance); anti-aliasing differences are ignored.
          threshold: 0.1,
          includeAA: false,
          alpha: 0.25,
          diffColor: [255, 72, 48],
        })
      : 0;
  const unionPixels = Math.max(imageA.width, imageB.width) * Math.max(imageA.height, imageB.height);
  const nonOverlap = unionPixels - width * height;
  const diffPixels = changed + nonOverlap;
  return {
    diffRatio: unionPixels > 0 ? diffPixels / unionPixels : 0,
    diffPixels,
    unionPixels,
    overlap: { width, height },
    sizes: { a: { width: imageA.width, height: imageA.height }, b: { width: imageB.width, height: imageB.height } },
    diffPng: PNG.sync.write(diff),
  };
}

/** Minimum share of changed pixels before a difference is called significant. */
export const VISUAL_FLOOR_RATIO = 0.01;

/**
 * Significance threshold derived from the calibration run: three times the
 * variation two normal runs showed, never below 1% of the page.
 */
export function visualThreshold(calibrationRatio: number | null): { ratio: number; explanation: string } {
  if (calibrationRatio === null) {
    return {
      ratio: VISUAL_FLOOR_RATIO,
      explanation: `No calibration comparison was available, so the fixed floor of ${(VISUAL_FLOOR_RATIO * 100).toFixed(1)}% changed pixels is used.`,
    };
  }
  const ratio = Math.max(VISUAL_FLOOR_RATIO, calibrationRatio * 3);
  return {
    ratio,
    explanation: `Two normal runs differed by ${(calibrationRatio * 100).toFixed(2)}% of pixels. A fault run counts as visually different only above ${(ratio * 100).toFixed(2)}% (3× that variation, at least ${(VISUAL_FLOOR_RATIO * 100).toFixed(1)}%).`,
  };
}
