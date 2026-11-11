import type { ImageLike } from "./types";

/** Sample the selection rim, where paper should surround the entire tool.
 * Bright, nearly neutral pixels tolerate ordinary paper shading/white balance.
 * Require support on three sides so a white tool on a dark surface cannot
 * select the learned-paper mode. Ambiguous/dark/colored rims use color. */
export function hasWhitePaperBackground(image: ImageLike, recognizedSheet = false): boolean {
  const { width, height, data } = image;
  if (width < 8 || height < 8 || data.length !== width * height * 4) return false;
  const fractions = [0, 1, 2, 3].map(side => {
    let paper = 0, bright = 0;
    for (let step = 0; step < 64; step++) for (const depth of [0, .01, .025]) {
      const along = (step + .5) / 64;
      const x = Math.round((width - 1) * (side < 2 ? along : side === 2 ? depth : 1 - depth));
      const y = Math.round((height - 1) * (side >= 2 ? along : side === 0 ? depth : 1 - depth));
      const i = (y * width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      const high = Math.max(r, g, b), low = Math.min(r, g, b);
      const level = (r + g + b) / 3;
      if (data[i + 3] >= 250 && level >= 75 && high - low <= Math.max(24, high * .16)) {
        paper++;
        if (level >= 145) bright++;
      }
    }
    return { paper: paper / 192, bright: bright / 192 };
  });
  // Shadows can darken white paper on more than one side. Require some bright
  // paper on two sides as well, so a uniformly gray/dark surface is ambiguous.
  const paper = fractions.reduce((sum, value) => sum + value.paper, 0) / 4;
  const bright = fractions.reduce((sum, value) => sum + value.bright, 0) / 4;
  // Validated sheet markers add evidence that a neutral, heavily shaded rim is
  // paper. They do not override a wood/colored/dark selection elsewhere in the
  // photo: the selection must still have a neutral majority and a lit patch.
  if (recognizedSheet && fractions.filter(value => value.paper >= .5).length >= 2 && paper >= .55 && bright >= .05) return true;
  return fractions.filter(value => value.paper >= .5).length >= 3
    && paper >= .6
    && fractions.filter(value => value.bright >= .15).length >= 2
    && bright >= .2;
}
