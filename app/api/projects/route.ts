import { NextRequest } from "next/server";
import { createProject, listProjects } from "@/lib/db";
import { fail, ok } from "@/lib/http";

export async function GET() {
  try {
    return ok({ projects: listProjects() });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to load projects", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json().catch(() => ({}))) as { title?: string };
    const project = createProject(payload.title?.trim() || undefined);
    return ok({ project }, 201);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to create project", 500);
  }
}
