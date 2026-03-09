import { getProject } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const project = getProject(id);

    if (!project) {
      return fail("Project not found", 404);
    }

    return ok({ project });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to load project", 500);
  }
}
