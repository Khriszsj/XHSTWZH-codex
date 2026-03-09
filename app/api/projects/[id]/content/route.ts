import { NextRequest } from "next/server";
import { z } from "zod";
import { getProject, saveProjectContent } from "@/lib/db";
import { getTemplate } from "@/lib/defaults";
import { sanitizeRichDoc } from "@/lib/doc";
import { fail, ok } from "@/lib/http";
import type { RichDoc, ThemeVars } from "@/lib/types";

const payloadSchema = z.object({
  title: z.string().min(1),
  templateId: z.string().min(1),
  themeVars: z.custom<ThemeVars>(),
  doc: z.custom<RichDoc>()
});

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const existing = getProject(id);

    if (!existing) {
      return fail("Project not found", 404);
    }

    const payload = payloadSchema.parse(await request.json());
    const template = getTemplate(payload.templateId);

    const project = saveProjectContent({
      id,
      title: payload.title.trim(),
      templateId: template.id,
      themeVars: payload.themeVars,
      doc: sanitizeRichDoc(payload.doc)
    });

    return ok({ project });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(error.issues.map((item) => item.message).join("; "), 422);
    }
    return fail(error instanceof Error ? error.message : "Failed to save project", 500);
  }
}
