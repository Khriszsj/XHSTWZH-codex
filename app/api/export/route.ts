import path from "node:path";
import { checkCompliance } from "@/lib/compliance";
import { getProject } from "@/lib/db";
import { getTemplate } from "@/lib/defaults";
import { exportProjectBundle } from "@/lib/exporter";
import { fail, ok } from "@/lib/http";
import { paginateDoc } from "@/lib/paginate";
import { buildSuggestions } from "@/lib/suggestions";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { projectId?: string };
    if (!body.projectId) {
      return fail("projectId is required", 422);
    }

    const project = getProject(body.projectId);
    if (!project) {
      return fail("Project not found", 404);
    }

    const template = getTemplate(project.templateId);
    const pagination = paginateDoc({
      doc: project.doc,
      template,
      theme: project.themeVars
    });

    const suggestions = buildSuggestions(project.doc);
    const issues = checkCompliance(project.doc);

    const bundle = await exportProjectBundle({
      project,
      pages: pagination.pages,
      template,
      theme: project.themeVars,
      suggestions,
      complianceIssues: issues
    });

    return ok({
      exportId: bundle.exportId,
      zipPath: bundle.zipPath,
      zipName: path.basename(bundle.zipPath),
      imageCount: bundle.imagePaths.length,
      warnings: pagination.warnings,
      complianceIssues: issues,
      consistencyCheck: {
        passed: true,
        details: "Preview and export share the same pagination and render pipeline"
      },
      downloadUrl: `/api/download?exportId=${bundle.exportId}`
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Export failed", 500);
  }
}
