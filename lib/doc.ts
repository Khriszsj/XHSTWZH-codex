import { createId } from "./id";
import type {
  DocNode,
  EditorOperation,
  ParagraphNode,
  RichDoc,
  TextMark,
  TextNode
} from "./types";

export function markdownToRichDoc(markdown: string, title = "未命名笔记"): RichDoc {
  const blocks = markdown
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const nodes: DocNode[] = blocks.length
    ? blocks.map((block) => {
        const lines = block.split("\n");
        const children: ParagraphNode["children"] = [];

        lines.forEach((line, index) => {
          if (line.length > 0) {
            children.push({
              type: "text",
              id: createId("txt"),
              text: line
            });
          }
          if (index < lines.length - 1) {
            children.push({
              type: "hardBreak",
              id: createId("br")
            });
          }
        });

        return {
          type: "paragraph",
          id: createId("para"),
          children
        };
      })
    : [
        {
          type: "paragraph",
          id: createId("para"),
          children: [
            {
              type: "text",
              id: createId("txt"),
              text: ""
            }
          ]
        }
      ];

  return {
    id: createId("doc"),
    title,
    nodes,
    updatedAt: Date.now()
  };
}

export function docToPlainText(doc: RichDoc): string {
  return doc.nodes
    .map((node) => {
      if (node.type === "image") {
        return "[图片]";
      }

      return node.children
        .map((inline) => {
          if (inline.type === "hardBreak") {
            return "\n";
          }
          return inline.text;
        })
        .join("");
    })
    .join("\n\n");
}

export function applyEditorOperations(doc: RichDoc, operations: EditorOperation[]): RichDoc {
  const cloned = structuredClone(doc);

  for (const op of operations) {
    const node = cloned.nodes[op.paragraphIndex];
    if (!node || node.type !== "paragraph") {
      continue;
    }

    if (op.type === "appendHardBreak") {
      node.children.push({ type: "hardBreak", id: createId("br") });
      continue;
    }

    if (op.type === "setParagraphSpacing") {
      const spacing = Number(op.payload?.spacing ?? 14);
      node.spacingAfter = Number.isNaN(spacing) ? 14 : spacing;
      continue;
    }

    const mutator = (textNode: TextNode, marks: Partial<TextMark>) => {
      textNode.marks = {
        ...textNode.marks,
        ...marks
      };
    };

    if (op.type === "setParagraphMark") {
      const bold = Boolean(op.payload?.bold);
      node.children.forEach((child) => {
        if (child.type === "text") {
          mutator(child, { bold });
        }
      });
      continue;
    }

    if (op.type === "setParagraphTextColor") {
      const color = String(op.payload?.color ?? "#111827");
      node.children.forEach((child) => {
        if (child.type === "text") {
          mutator(child, { color });
        }
      });
      continue;
    }

    if (op.type === "setParagraphFontSize") {
      const fontSize = Number(op.payload?.fontSize ?? 36);
      node.children.forEach((child) => {
        if (child.type === "text") {
          mutator(child, { fontSize });
        }
      });
    }
  }

  cloned.updatedAt = Date.now();
  return cloned;
}

export function createImageNode(params: {
  assetId: string;
  src: string;
  width: number;
  height: number;
}): DocNode {
  return {
    type: "image",
    id: createId("img"),
    assetId: params.assetId,
    src: params.src,
    width: params.width,
    height: params.height,
    align: "center"
  };
}

export function sanitizeRichDoc(input: RichDoc): RichDoc {
  const nodes = input.nodes
    .filter((node) => {
      if (node.type === "image") {
        return Boolean(node.assetId) && Boolean(node.src);
      }

      return node.children.some((child) => {
        if (child.type === "hardBreak") {
          return true;
        }
        return child.text.length > 0;
      });
    })
    .map((node) => {
      if (node.type === "image") {
        return {
          ...node,
          align: node.align || "center"
        };
      }

      const children = node.children.map((child) => {
        if (child.type === "hardBreak") {
          return child;
        }

        return {
          ...child,
          marks: normalizeMarks(child.marks)
        };
      });

      return {
        ...node,
        spacingAfter: node.spacingAfter ?? 14,
        children
      };
    });

  return {
    ...input,
    nodes: nodes.length
      ? nodes
      : [
          {
            type: "paragraph",
            id: createId("para"),
            children: [
              {
                type: "text",
                id: createId("txt"),
                text: ""
              }
            ]
          }
        ],
    updatedAt: Date.now()
  };
}

function normalizeMarks(marks?: TextMark): TextMark | undefined {
  if (!marks) {
    return undefined;
  }

  const output: TextMark = {};

  if (marks.bold) {
    output.bold = true;
  }
  if (marks.color) {
    output.color = marks.color;
  }
  if (marks.fontSize && Number.isFinite(marks.fontSize)) {
    output.fontSize = marks.fontSize;
  }
  if (marks.lineHeight && Number.isFinite(marks.lineHeight)) {
    output.lineHeight = Math.max(1, Math.min(3, marks.lineHeight));
  }
  if (marks.letterSpacing && Number.isFinite(marks.letterSpacing)) {
    output.letterSpacing = Math.max(-4, Math.min(24, marks.letterSpacing));
  }
  if (marks.paddingInline && Number.isFinite(marks.paddingInline)) {
    output.paddingInline = Math.max(0, Math.min(120, marks.paddingInline));
  }

  return Object.keys(output).length ? output : undefined;
}
