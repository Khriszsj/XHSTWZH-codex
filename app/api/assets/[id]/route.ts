import fs from "node:fs";
import { getAsset } from "@/lib/db";
import { fail } from "@/lib/http";
import { resolveExistingAssetPath } from "@/lib/storage";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const asset = getAsset(id);

    if (!asset) {
      return fail("Asset not found", 404);
    }

    const resolvedPath = resolveExistingAssetPath(asset);
    if (!resolvedPath) {
      return fail("Asset file not found", 404);
    }

    const buffer = await fs.promises.readFile(resolvedPath);
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": asset.type,
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to read asset", 500);
  }
}
