/** Only single image URLs and explicit light/dark sources enter Markdown pictures. */
export function pictureSource(srcset, media) {
  const scheme = /^\(prefers-color-scheme:\s*(dark|light)\)$/i
    .exec(media.trim())?.[1]
    .toLowerCase();
  const src = srcset.trim();
  // Multiple candidates, descriptors, controls and data URLs require a srcset parser.
  if (
    !scheme ||
    !src ||
    /[\s,]/.test(src) ||
    [...src].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return null;
  const protocol = /^([a-z][a-z0-9+.-]*):/i.exec(src)?.[1];
  if (protocol && !/^https?$/i.test(protocol)) return null;
  return { src, scheme };
}
