"use client";

import { createId } from "@/lib/id";
import type { InlineNode, RichDoc, TextMark } from "@/lib/types";

function escapeHtml(source: string): string {
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function rgbToHex(color: string): string {
  const normalized = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) {
    return normalized;
  }

  const match = normalized.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) {
    return color;
  }

  const toHex = (value: string) => Number(value).toString(16).padStart(2, "0");
  return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`;
}

function extractAssetIdFromSrc(src: string): string {
  if (!src) {
    return "";
  }

  try {
    const normalized = src.startsWith("http://") || src.startsWith("https://")
      ? new URL(src).pathname
      : src;
    const match = normalized.match(/\/api\/assets\/([^/?#]+)/);
    return match?.[1] || "";
  } catch {
    const match = src.match(/\/api\/assets\/([^/?#]+)/);
    return match?.[1] || "";
  }
}

function normalizeImageSrc(rawSrc: string, assetId: string): string {
  const src = rawSrc.trim();
  if (!src) {
    return assetId ? `/api/assets/${assetId}` : "";
  }

  try {
    if (src.startsWith("http://") || src.startsWith("https://")) {
      const parsed = new URL(src);
      if (parsed.pathname.startsWith("/api/assets/")) {
        return parsed.pathname;
      }
      return src;
    }
  } catch {
    // Fall through to string-based normalization.
  }

  if (src.startsWith("/api/assets/")) {
    const clean = src.split("?")[0];
    return clean;
  }

  if ((src.startsWith("blob:") || src.startsWith("data:")) && assetId) {
    return `/api/assets/${assetId}`;
  }

  return src;
}

function markStyle(marks?: TextMark): string {
  if (!marks) {
    return "white-space:break-spaces";
  }

  const styles = ["white-space:break-spaces"];
  if (marks.bold) {
    styles.push("font-weight:700");
  }
  if (marks.color) {
    styles.push(`color:${marks.color}`);
  }
  if (marks.fontSize) {
    styles.push(`font-size:${marks.fontSize}px`);
  }
  if (marks.lineHeight) {
    styles.push(`line-height:${marks.lineHeight}`);
  }
  if (marks.letterSpacing || marks.letterSpacing === 0) {
    styles.push(`letter-spacing:${marks.letterSpacing}px`);
  }
  if (marks.paddingInline) {
    styles.push(`padding-left:${marks.paddingInline}px`);
    styles.push(`padding-right:${marks.paddingInline}px`);
    styles.push("display:inline-block");
  }

  return styles.join(";");
}

function inlineToHtml(inline: InlineNode): string {
  if (inline.type === "hardBreak") {
    return `<br data-inline-type="hardBreak" data-inline-id="${inline.id}"/>`;
  }

  return `<span data-inline-id="${inline.id}" style="${markStyle(inline.marks)}">${escapeHtml(inline.text)}</span>`;
}

function imageNodeToHtml(node: Extract<RichDoc["nodes"][number], { type: "image" }>): string {
  const width = Math.max(40, Math.round(node.width));
  const height = Math.max(40, Math.round(node.height));
  const resolvedSrc = normalizeImageSrc(node.src || "", node.assetId || "");

  return `<figure data-node-type="image" data-node-id="${node.id}" data-asset-id="${node.assetId}" data-original-width="${width}" data-original-height="${height}" data-render-width="${width}" data-render-height="${height}" data-render-percent="100" data-align="${node.align}" contenteditable="false" style="display:flex;justify-content:center;margin:10px 0 18px;">
  <img src="${escapeHtml(resolvedSrc)}" data-asset-id="${node.assetId}" style="width:${width}px;height:${height}px;max-width:100%;object-fit:contain;border-radius:12px;display:block" alt="" />
</figure>`;
}

export function richDocToEditorHtml(doc: RichDoc): string {
  return doc.nodes
    .map((node) => {
      if (node.type === "image") {
        return imageNodeToHtml(node);
      }

      const children = node.children.map(inlineToHtml).join("");
      return `<p data-node-type="paragraph" data-node-id="${node.id}" style="margin:0 0 ${node.spacingAfter ?? 14}px;white-space:pre-wrap">${children || "<br/>"}</p>`;
    })
    .join("\n");
}

function parseMarks(element: HTMLElement, inherited?: TextMark): TextMark | undefined {
  const marks: TextMark = { ...(inherited ?? {}) };

  const weight = (element.style.fontWeight || "").trim().toLowerCase();
  const parsedWeight = Number.parseInt(weight, 10);
  const hasExplicitWeight = weight.length > 0;
  const isTagBold = element.tagName === "B" || element.tagName === "STRONG";
  const isWeightBold = weight === "bold" || (Number.isFinite(parsedWeight) && parsedWeight >= 600);
  const isWeightNormal =
    weight === "normal" || (Number.isFinite(parsedWeight) && parsedWeight > 0 && parsedWeight < 600);

  if ((isTagBold && !hasExplicitWeight) || isWeightBold) {
    marks.bold = true;
  } else if (isWeightNormal) {
    delete marks.bold;
  }

  const color = element.style.color || element.getAttribute("color") || "";
  if (color) {
    marks.color = rgbToHex(color);
  }

  const inlineFontSize = element.style.fontSize;
  const sizeAttr = element.getAttribute("size");
  const mappedFromSizeAttr = sizeAttr ? Number(sizeAttr) * 4 + 8 : NaN;
  const parsed = inlineFontSize
    ? parseInt(inlineFontSize, 10)
    : Number.isNaN(mappedFromSizeAttr)
      ? NaN
      : mappedFromSizeAttr;

  if (!Number.isNaN(parsed) && parsed > 0) {
    marks.fontSize = parsed;
  }

  const lineHeight = element.style.lineHeight;
  if (lineHeight) {
    if (lineHeight.endsWith("px")) {
      const px = parseFloat(lineHeight);
      const font = marks.fontSize || inherited?.fontSize || 36;
      if (Number.isFinite(px) && px > 0 && font > 0) {
        marks.lineHeight = Number((px / font).toFixed(3));
      }
    } else {
      const ratio = parseFloat(lineHeight);
      if (Number.isFinite(ratio) && ratio > 0) {
        marks.lineHeight = Number(ratio.toFixed(3));
      }
    }
  }

  const letterSpacing = parseFloat(element.style.letterSpacing);
  if (Number.isFinite(letterSpacing)) {
    marks.letterSpacing = Number(letterSpacing.toFixed(2));
  }

  const paddingInlineRaw =
    parseFloat(element.style.paddingInline) ||
    Math.max(parseFloat(element.style.paddingLeft) || 0, parseFloat(element.style.paddingRight) || 0);
  if (Number.isFinite(paddingInlineRaw) && paddingInlineRaw > 0) {
    marks.paddingInline = Number(paddingInlineRaw.toFixed(2));
  }

  return Object.keys(marks).length ? marks : undefined;
}

function walkInline(node: ChildNode, marks: TextMark | undefined, bucket: InlineNode[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    const chunks = text.replace(/\r/g, "").split("\n");

    chunks.forEach((chunk, index) => {
      if (chunk.length > 0) {
        bucket.push({
          type: "text",
          id: createId("txt"),
          text: chunk,
          marks
        });
      }

      if (index < chunks.length - 1) {
        bucket.push({
          type: "hardBreak",
          id: createId("br")
        });
      }
    });
    return;
  }

  if (!(node instanceof HTMLElement)) {
    return;
  }

  if (node.tagName === "BR") {
    bucket.push({
      type: "hardBreak",
      id: createId("br")
    });
    return;
  }

  if (isImageElement(node)) {
    return;
  }

  const nextMarks = parseMarks(node, marks);

  if (!node.childNodes.length) {
    return;
  }

  node.childNodes.forEach((child) => walkInline(child, nextMarks, bucket));
}

function isImageElement(element: HTMLElement): boolean {
  return (
    element.dataset.nodeType === "image" ||
    element.tagName === "FIGURE" ||
    element.tagName === "IMG"
  );
}

function parseImageElement(element: HTMLElement): Extract<RichDoc["nodes"][number], { type: "image" }> | null {
  const container = element.tagName === "IMG"
    ? (element.closest("figure") as HTMLElement | null) ?? element
    : element;

  const image = container.tagName === "IMG"
    ? (container as HTMLImageElement)
    : (container.querySelector("img") as HTMLImageElement | null);

  if (!image) {
    return null;
  }

  const rawSrc = image.getAttribute("src") || "";
  const srcAssetId = extractAssetIdFromSrc(rawSrc);
  const assetId =
    container.dataset.assetId || image.getAttribute("data-asset-id") || srcAssetId || "";
  const src = normalizeImageSrc(rawSrc, assetId);

  if (!assetId || !src) {
    return null;
  }

  const originalWidth = Number(
    container.dataset.originalWidth ||
      container.dataset.width ||
      image.naturalWidth ||
      image.clientWidth ||
      640
  );
  const originalHeight = Number(
    container.dataset.originalHeight ||
      container.dataset.height ||
      image.naturalHeight ||
      image.clientHeight ||
      640
  );

  const renderWidth = Number(
    container.dataset.renderWidth ||
      parseInt(image.style.width || "", 10) ||
      image.clientWidth ||
      originalWidth
  );

  const renderHeight = Number(
    container.dataset.renderHeight ||
      parseInt(image.style.height || "", 10) ||
      Math.round((originalHeight / Math.max(1, originalWidth)) * renderWidth)
  );

  return {
    type: "image",
    id: container.dataset.nodeId || createId("img"),
    assetId,
    src,
    width: Math.max(40, Math.round(renderWidth)),
    height: Math.max(40, Math.round(renderHeight)),
    align: (container.dataset.align as "left" | "center" | "right") || "center"
  };
}

function pushParagraph(
  nodes: RichDoc["nodes"],
  inlineBucket: InlineNode[],
  paragraphId?: string,
  keepEmpty = false
): void {
  const children = inlineBucket.length
    ? inlineBucket
    : keepEmpty
      ? [
          {
            type: "hardBreak" as const,
            id: createId("br")
          }
        ]
      : [];
  if (!children.length) {
    return;
  }

  nodes.push({
    type: "paragraph",
    id: paragraphId || createId("para"),
    spacingAfter: 14,
    children
  });
}

export function editorElementToRichDoc(root: HTMLElement, previous: RichDoc): RichDoc {
  const nodes: RichDoc["nodes"] = [];

  root.childNodes.forEach((rawNode) => {
    if (!(rawNode instanceof HTMLElement)) {
      return;
    }

    if (rawNode.tagName === "UL" || rawNode.tagName === "OL") {
      const listItems = [...rawNode.querySelectorAll(":scope > li")];
      listItems.forEach((li) => {
        const inlineBucket: InlineNode[] = [
          {
            type: "text",
            id: createId("txt"),
            text: "• "
          }
        ];
        li.childNodes.forEach((child) => walkInline(child, undefined, inlineBucket));
        pushParagraph(nodes, inlineBucket);
      });
      return;
    }

    if (isImageElement(rawNode)) {
      const imageNode = parseImageElement(rawNode);
      if (imageNode) {
        nodes.push(imageNode);
      }
      return;
    }

    const paragraphMarks = parseMarks(rawNode);
    let inlineBucket: InlineNode[] = [];

    rawNode.childNodes.forEach((child) => {
      if (child instanceof HTMLElement && isImageElement(child)) {
        pushParagraph(nodes, inlineBucket, rawNode.dataset.nodeId || createId("para"));
        inlineBucket = [];

        const imageNode = parseImageElement(child);
        if (imageNode) {
          nodes.push(imageNode);
        }
        return;
      }

      walkInline(child, paragraphMarks, inlineBucket);
    });

    const keepEmpty = rawNode.tagName === "P" || rawNode.tagName === "DIV";
    pushParagraph(nodes, inlineBucket, rawNode.dataset.nodeId || createId("para"), keepEmpty);
  });

  return {
    ...previous,
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
