/** Fixed physical contract for the H2D board. New XY geometry requires new IDs. */
export const H2D_PHOTO_BOARD = {
  width: 315,
  height: 310,
  thickness: 6,
  cornerRadius: 8,
  markerSize: 30,
  markerInset: 26,
  markerIds: [16, 17, 18, 19],
  tileSize: 40,
  tileThickness: 2.4,
  tileClearance: 0.15,
  tileKeyChamfer: 3,
  adhesionRadius: 8,
  adhesionInset: 4,
  adhesionThickness: 0.4,
} as const;
