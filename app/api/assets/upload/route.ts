import fs from "node:fs";
import path from "node:path";
import { imageSize } from "image-size";
import { createAsset, ensureProjectAssetDir, getProject } from "@/lib/db";
import { sha1 } from "@/lib/hash";
import { fail, ok } from "@/lib/http";

const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif"
]);

function extensionByType(type: string): string {
  if (type === "image/png") {
    return "png";
  }
  if (type === "image/webp") {
    return "webp";
  }
  if (type === "image/gif") {
    return "gif";
  }
  if (type === "image/heic" || type === "image/heif") {
    return "heic";
  }
  return "jpg";
}

function isUploadableFile(file: unknown): file is Blob & { type: string; arrayBuffer: () => Promise<ArrayBuffer> } {
  return Boolean(
    file &&
      typeof file === "object" &&
      "arrayBuffer" in file &&
      typeof (file as { arrayBuffer?: unknown }).arrayBuffer === "function"
  );
}

function detectExtensionByName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) {
    return "png";
  }
  if (lower.endsWith(".webp")) {
    return "webp";
  }
  if (lower.endsWith(".gif")) {
    return "gif";
  }
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) {
    return "heic";
  }
  return "jpg";
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const projectId = String(formData.get("projectId") ?? "").trim();
    const file = formData.get("file");

    if (!projectId) {
      return fail("projectId is required", 422);
    }

    if (!getProject(projectId)) {
      return fail("Project not found", 404);
    }

    if (!isUploadableFile(file)) {
      return fail("file is required", 422);
    }

    const maybeType = String((file as { type?: string }).type ?? "").toLowerCase();
    const maybeName = String((file as { name?: string }).name ?? "");
    const fallbackExt = detectExtensionByName(maybeName);

    const mime = maybeType || (fallbackExt === "png"
      ? "image/png"
      : fallbackExt === "webp"
        ? "image/webp"
        : fallbackExt === "gif"
          ? "image/gif"
          : fallbackExt === "heic"
            ? "image/heic"
            : "image/jpeg");

    if (!ALLOWED.has(mime)) {
      return fail("暂仅支持 PNG/JPG/WebP/GIF/HEIC", 415);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const size = imageSize(buffer);

    const fallbackWidth = Number(formData.get("width") ?? 0);
    const fallbackHeight = Number(formData.get("height") ?? 0);
    const width = size.width ?? (Number.isFinite(fallbackWidth) ? fallbackWidth : 0);
    const height = size.height ?? (Number.isFinite(fallbackHeight) ? fallbackHeight : 0);

    if (!width || !height) {
      return fail("Unable to read image size", 422);
    }

    // Prevent accidental tracking-pixel-like uploads that render as white squares.
    if (width <= 2 && height <= 2) {
      return fail("图片尺寸过小（疑似空白像素图），请上传正常图片", 422);
    }

    const hash = sha1(buffer);
    const ext = extensionByType(mime);
    const dir = ensureProjectAssetDir(projectId);
    const fileName = `${hash}.${ext}`;
    const localPath = path.join(dir, fileName);

    if (!fs.existsSync(localPath)) {
      await fs.promises.writeFile(localPath, buffer);
    }

    const asset = createAsset({
      projectId,
      type: mime,
      width,
      height,
      localPath,
      hash
    });

    return ok({
      assetId: asset.id,
      url: `/api/assets/${asset.id}`,
      size: {
        width: asset.width,
        height: asset.height
      }
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Upload failed", 500);
  }
}
