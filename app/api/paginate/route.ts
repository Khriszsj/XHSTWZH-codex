import { z } from "zod";
import { getTemplate } from "@/lib/defaults";
import { sanitizeRichDoc } from "@/lib/doc";
import { fail, ok } from "@/lib/http";
import { paginateDoc } from "@/lib/paginate";
import type { RichDoc, ThemeVars } from "@/lib/types";

const schema = z.object({
  templateId: z.string().min(1).optional(),
  themeVars: z.custom<ThemeVars>(),
  doc: z.custom<RichDoc>()
});

export async function POST(request: Request) {
  try {
    const payload = schema.parse(await request.json());
    const template = getTemplate(payload.templateId);
    const doc = sanitizeRichDoc(payload.doc);

    const result = paginateDoc({
      doc,
      template,
      theme: payload.themeVars
    });

    return ok({
      pages: result.pages,
      warnings: result.warnings
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(error.issues.map((item) => item.message).join("; "), 422);
    }
    return fail(error instanceof Error ? error.message : "Failed to paginate", 500);
  }
}
