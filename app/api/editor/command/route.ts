import { z } from "zod";
import { applyEditorOperations, sanitizeRichDoc } from "@/lib/doc";
import { fail, ok } from "@/lib/http";
import { parseEditorCommand } from "@/lib/command-engine";
import type { RichDoc } from "@/lib/types";

const schema = z.object({
  command: z.string().min(1),
  doc: z.custom<RichDoc>()
});

export async function POST(request: Request) {
  try {
    const payload = schema.parse(await request.json());
    const doc = sanitizeRichDoc(payload.doc);
    const result = parseEditorCommand(payload.command, doc);

    if (!result.operations.length) {
      return ok({ result, patchedDoc: doc });
    }

    const patchedDoc = applyEditorOperations(doc, result.operations);
    return ok({ result, patchedDoc });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(error.issues.map((item) => item.message).join("; "), 422);
    }
    return fail(error instanceof Error ? error.message : "Failed to parse command", 500);
  }
}
