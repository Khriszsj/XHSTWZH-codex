import type { EditorCommandResult, EditorOperation, RichDoc } from "./types";

const COLOR_MAP: Record<string, string> = {
  红色: "#dc2626",
  蓝色: "#2563eb",
  黑色: "#111827",
  灰色: "#6b7280",
  绿色: "#16a34a",
  橙色: "#ea580c",
  紫色: "#7c3aed",
  粉色: "#db2777"
};

function parseParagraphIndex(text: string, doc: RichDoc): number {
  const paragraphIndexes = doc.nodes
    .map((node, index) => ({ node, index }))
    .filter((item) => item.node.type === "paragraph")
    .map((item) => item.index);

  const explicit = text.match(/第\s*(\d+)\s*段/);
  if (explicit) {
    const paragraphOrder = Number(explicit[1]) - 1;
    if (paragraphOrder >= 0 && paragraphOrder < paragraphIndexes.length) {
      return paragraphIndexes[paragraphOrder];
    }
  }

  return paragraphIndexes[0] ?? 0;
}

export function parseEditorCommand(input: string, doc: RichDoc): EditorCommandResult {
  const normalized = input.trim();
  const paragraphIndex = parseParagraphIndex(normalized, doc);
  const operations: EditorOperation[] = [];
  let score = 0;

  if (/加粗|粗体/.test(normalized)) {
    operations.push({
      type: "setParagraphMark",
      paragraphIndex,
      payload: { bold: true }
    });
    score += 0.25;
  }

  const fontSizeMatch = normalized.match(/(\d{1,2})\s*(号|px|像素)/);
  if (fontSizeMatch) {
    operations.push({
      type: "setParagraphFontSize",
      paragraphIndex,
      payload: { fontSize: Number(fontSizeMatch[1]) }
    });
    score += 0.25;
  }

  const colorKeyword = Object.keys(COLOR_MAP).find((key) => normalized.includes(key));
  if (colorKeyword) {
    operations.push({
      type: "setParagraphTextColor",
      paragraphIndex,
      payload: { color: COLOR_MAP[colorKeyword] }
    });
    score += 0.25;
  }

  if (/空一行|换一行|加空行/.test(normalized)) {
    operations.push({
      type: "appendHardBreak",
      paragraphIndex
    });
    score += 0.25;
  }

  const spacingMatch = normalized.match(/段后\s*(\d{1,3})\s*(px|像素)?/);
  if (spacingMatch) {
    operations.push({
      type: "setParagraphSpacing",
      paragraphIndex,
      payload: { spacing: Number(spacingMatch[1]) }
    });
    score += 0.2;
  }

  if (!operations.length) {
    return {
      intent: "unknown",
      confidence: 0.2,
      operations: []
    };
  }

  return {
    intent: "style_edit",
    confidence: Math.min(0.98, score + 0.2),
    operations
  };
}
