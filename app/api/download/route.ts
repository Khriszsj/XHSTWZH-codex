import fs from "node:fs";
import path from "node:path";
import { getExportPath } from "@/lib/db";
import { fail } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const exportId = searchParams.get("exportId");

    if (!exportId) {
      return fail("exportId is required", 422);
    }

    const zipPath = getExportPath(exportId);
    if (!zipPath) {
      return fail("Export not found", 404);
    }

    const file = await fs.promises.readFile(zipPath);
    return new Response(file, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename=\"${path.basename(zipPath)}\"`
      }
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to download export", 500);
  }
}
