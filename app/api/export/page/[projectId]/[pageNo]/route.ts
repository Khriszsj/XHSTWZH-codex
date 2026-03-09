import fs from "node:fs";
import { getProject } from "@/lib/db";
import { getTemplate } from "@/lib/defaults";
import { exportSinglePage } from "@/lib/exporter";
import { fail } from "@/lib/http";
import { paginateDoc } from "@/lib/paginate";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; pageNo: string }> }
) {
  try {
    const { projectId, pageNo } = await context.params;
    const pageNumber = Number(pageNo);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      return fail("Invalid pageNo", 422);
    }

    const project = getProject(projectId);
    if (!project) {
      return fail("Project not found", 404);
    }

    const template = getTemplate(project.templateId);
    const pagination = paginateDoc({
      doc: project.doc,
      template,
      theme: project.themeVars
    });

    const file = await exportSinglePage({
      projectId: project.id,
      projectTitle: project.title,
      pages: pagination.pages,
      template,
      theme: project.themeVars,
      pageNo: pageNumber
    });

    const content = await fs.promises.readFile(file.filePath);
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename=\"${file.fileName}\"`,
        "X-File-Hash": file.hash
      }
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Single page export failed", 500);
  }
}
