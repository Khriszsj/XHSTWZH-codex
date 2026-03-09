const IMAGE_MIME_EXTENSION_MAP: Record<string, readonly string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/jpg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "image/heic": ["heic", "heif"],
  "image/heif": ["heif", "heic"]
};

const EXTENSION_MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif"
};

export const SUPPORTED_IMAGE_TYPES = Object.keys(IMAGE_MIME_EXTENSION_MAP);
export const SUPPORTED_IMAGE_EXTENSIONS = Object.keys(EXTENSION_MIME_MAP);

function normalizeMimeType(type: string): string {
  return type.trim().toLowerCase();
}

export function getExtensionsForImageMimeType(type: string): string[] {
  return [...(IMAGE_MIME_EXTENSION_MAP[normalizeMimeType(type)] ?? [])];
}

export function isSupportedImageMimeType(type: string): boolean {
  return normalizeMimeType(type) in IMAGE_MIME_EXTENSION_MAP;
}

export function detectImageExtension(fileName: string, mimeType = ""): string {
  const mimeExtensions = getExtensionsForImageMimeType(mimeType);
  if (mimeExtensions.length > 0) {
    return mimeExtensions[0];
  }

  const lowerName = fileName.toLowerCase();
  const matched = SUPPORTED_IMAGE_EXTENSIONS.find((ext) => lowerName.endsWith(`.${ext}`));
  return matched ?? "jpg";
}

export function inferImageMimeType(type: string, fileName = ""): string | null {
  const normalizedType = normalizeMimeType(type);
  if (isSupportedImageMimeType(normalizedType)) {
    return normalizedType;
  }

  const extension = detectImageExtension(fileName);
  return EXTENSION_MIME_MAP[extension] ?? null;
}
