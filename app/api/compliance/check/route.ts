import { z } from "zod";
import { checkCompliance } from "@/lib/compliance";
import { sanitizeRichDoc } from "@/lib/doc";
import { fail, ok } from "@/lib/http";
import type { RichDoc } from "@/lib/types";

const schema = z.object({
  doc: z.custom<RichDoc>()
});

export async function POST(request: Request) {
  try {
    const payload = schema.parse(await request.json());
    const issues = checkCompliance(sanitizeRichDoc(payload.doc));
    return ok({ issues });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(error.issues.map((item) => item.message).join("; "), 422);
    }
    return fail(error instanceof Error ? error.message : "Compliance check failed", 500);
  }
}
