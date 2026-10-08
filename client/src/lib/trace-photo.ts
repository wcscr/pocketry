export const TRACE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const TRACE_PHOTO_ACCEPT = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
};
export const TRACE_PHOTO_FORMAT_ERROR = "Choose a PNG, JPG, or WebP photo.";
export const TRACE_PHOTO_SIZE_ERROR = "This photo is too large. Choose a photo up to 10 MB.";

/** Apply the same limits to drops, the initial picker, and replacement photos. */
export function tracePhotoError(file: Pick<File, "name" | "type" | "size">): string | null {
  if (!Object.keys(TRACE_PHOTO_ACCEPT).includes(file.type) && !(file.type === "" && /\.(png|jpe?g|webp)$/i.test(file.name))) {
    return TRACE_PHOTO_FORMAT_ERROR;
  }
  return file.size > TRACE_PHOTO_MAX_BYTES ? TRACE_PHOTO_SIZE_ERROR : null;
}
