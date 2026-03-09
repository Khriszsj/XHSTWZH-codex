import fs from "node:fs";
import path from "node:path";
import type { Asset } from "./types";

const ROOT = process.cwd();
const STORAGE_DIR = path.join(ROOT, "storage");
export const DB_PATH = path.join(STORAGE_DIR, "app.db");
export const ASSET_DIR = path.join(STORAGE_DIR, "assets");
export const EXPORT_DIR = path.join(STORAGE_DIR, "exports");
export const TMP_DIR = path.join(STORAGE_DIR, "tmp");

export function ensureStorage(): void {
  for (const dir of [STORAGE_DIR, ASSET_DIR, EXPORT_DIR, TMP_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function safeResolveExportFile(fileName: string): string {
  const normalized = path.normalize(fileName).replace(/^\.+/, "");
  const resolved = path.join(EXPORT_DIR, normalized);

  if (!resolved.startsWith(EXPORT_DIR)) {
    throw new Error("Invalid export path");
  }
  return resolved;
}

function extByMime(mime: string): string[] {
  const normalized = (mime || "").toLowerCase();
  if (normalized === "image/png") return ["png"];
  if (normalized === "image/jpeg" || normalized === "image/jpg") return ["jpg", "jpeg"];
  if (normalized === "image/webp") return ["webp"];
  if (normalized === "image/gif") return ["gif"];
  if (normalized === "image/heic" || normalized === "image/heif") return ["heic", "heif"];
  return [];
}

export function resolveExistingAssetPath(asset: Asset): string | null {
  const candidates = new Set<string>();

  if (asset.localPath) {
    candidates.add(asset.localPath);
  }

  const projectDir = path.join(ASSET_DIR, asset.projectId);
  const fileNameFromLocal = asset.localPath ? path.basename(asset.localPath) : "";
  if (fileNameFromLocal) {
    candidates.add(path.join(projectDir, fileNameFromLocal));
  }

  const exts = new Set<string>(extByMime(asset.type));
  const extFromLocal = path.extname(asset.localPath || "").replace(".", "").toLowerCase();
  if (extFromLocal) {
    exts.add(extFromLocal);
  }
  // Safe fallback extension list.
  for (const ext of ["png", "jpg", "jpeg", "webp", "gif", "heic", "heif"]) {
    exts.add(ext);
  }

  if (asset.hash) {
    for (const ext of exts) {
      candidates.add(path.join(projectDir, `${asset.hash}.${ext}`));
    }
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
