export function normalizeHexColor(color: string, fallback: string): string {
  const normalized = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) {
    return normalized;
  }

  const match = normalized.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) {
    return fallback;
  }

  const toHex = (value: string) => Number(value).toString(16).padStart(2, "0");
  return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`;
}
