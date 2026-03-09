import { createId } from "./id";
import type {
  InlineNode,
  PageImageItem,
  PageItem,
  PageLineItem,
  PageRender,
  PaginationResult,
  ParagraphNode,
  RichDoc,
  Template,
  TextMark,
  TextRun,
  ThemeVars
} from "./types";

interface PreparedLine {
  runs: TextRun[];
  lineHeight: number;
}

interface MeasureContext {
  contentWidth: number;
  baseFontSize: number;
  lineHeightRatio: number;
}

function isCjk(char: string): boolean {
  return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(char);
}

function isEmoji(char: string): boolean {
  return /\p{Extended_Pictographic}/u.test(char);
}

function measureCharWidth(char: string, fontSize: number, bold = false, letterSpacing = 0): number {
  let width = fontSize * 0.62;

  if (char === "\t") {
    width = fontSize * 1.6;
  } else if (char === " ") {
    width = fontSize * 0.42;
  } else if (isEmoji(char)) {
    width = fontSize * 1.08;
  } else if (isCjk(char)) {
    width = fontSize * 1.04;
  } else {
    width = fontSize * 0.62;
  }

  if (bold) {
    width *= 1.06;
  }

  width += letterSpacing;

  // Keep a small safety margin so the browser doesn't second-wrap a line.
  return width * 1.04;
}

function marksEqual(a?: TextMark, b?: TextMark): boolean {
  return (a?.bold ?? false) === (b?.bold ?? false) &&
    (a?.color ?? "") === (b?.color ?? "") &&
    (a?.fontSize ?? 0) === (b?.fontSize ?? 0) &&
    (a?.lineHeight ?? 0) === (b?.lineHeight ?? 0) &&
    (a?.letterSpacing ?? 0) === (b?.letterSpacing ?? 0) &&
    (a?.paddingInline ?? 0) === (b?.paddingInline ?? 0);
}

function makeLineFromRuns(runs: TextRun[], lineHeight: number): PreparedLine {
  return {
    runs,
    lineHeight: Math.max(20, lineHeight)
  };
}

function pushChar(
  runs: TextRun[],
  char: string,
  marks: TextMark | undefined
): TextRun[] {
  if (!runs.length) {
    runs.push({ text: char, marks });
    return runs;
  }

  const last = runs[runs.length - 1];
  if (marksEqual(last.marks, marks)) {
    last.text += char;
    return runs;
  }

  runs.push({ text: char, marks });
  return runs;
}

function paragraphToLines(node: ParagraphNode, ctx: MeasureContext): PreparedLine[] {
  const lines: PreparedLine[] = [];
  let runs: TextRun[] = [];
  let lineWidth = 0;
  let maxLineHeight = Math.max(20, Math.round(ctx.baseFontSize * ctx.lineHeightRatio));

  const flushLine = (forceEmpty = false): void => {
    if (!runs.length && !forceEmpty) {
      return;
    }

    const lineRuns = runs.length ? runs : [{ text: "", marks: { fontSize: ctx.baseFontSize } }];
    lines.push(makeLineFromRuns(lineRuns, maxLineHeight));

    runs = [];
    lineWidth = 0;
    maxLineHeight = Math.max(20, Math.round(ctx.baseFontSize * ctx.lineHeightRatio));
  };

  const processTextNode = (inline: InlineNode): void => {
    if (inline.type !== "text") {
      return;
    }

    const source = inline.text;
    for (const char of source) {
      if (char === "\r") {
        continue;
      }

      if (char === "\n") {
        flushLine(true);
        continue;
      }

      const fontSize = inline.marks?.fontSize ?? ctx.baseFontSize;
      const letterSpacing = inline.marks?.letterSpacing ?? 0;
      const width = measureCharWidth(char, fontSize, inline.marks?.bold, letterSpacing);
      const lineHeightRatio = inline.marks?.lineHeight ?? ctx.lineHeightRatio;

      if (lineWidth + width > ctx.contentWidth && lineWidth > 0) {
        flushLine();
      }

      pushChar(runs, char, inline.marks);
      lineWidth += width;
      maxLineHeight = Math.max(maxLineHeight, Math.round(fontSize * lineHeightRatio));
    }
  };

  for (const inline of node.children) {
    if (inline.type === "hardBreak") {
      flushLine(true);
      continue;
    }

    processTextNode(inline);
  }

  flushLine();
  return lines;
}

function createEmptyPage(pageNo: number): PageRender {
  return {
    pageNo,
    usedHeight: 0,
    items: []
  };
}

export function paginateDoc(params: {
  doc: RichDoc;
  template: Template;
  theme: ThemeVars;
}): PaginationResult {
  const { doc, template, theme } = params;
  const warnings: string[] = [];

  const contentWidth =
    template.canvasWidth - theme.pagePaddingLeft - theme.pagePaddingRight;
  const contentHeight =
    template.canvasHeight - theme.pagePaddingTop - theme.pagePaddingBottom;

  const pages: PageRender[] = [createEmptyPage(1)];
  let currentPage = pages[0];

  const pushItem = (item: PageItem, height: number, forceNewPage = true): void => {
    if (
      currentPage.usedHeight + height > contentHeight &&
      currentPage.items.length > 0 &&
      forceNewPage
    ) {
      currentPage = createEmptyPage(pages.length + 1);
      pages.push(currentPage);
    }

    currentPage.items.push(item);
    currentPage.usedHeight += height;
  };

  for (const node of doc.nodes) {
    if (node.type === "paragraph") {
      const lines = paragraphToLines(node, {
        contentWidth,
        baseFontSize: theme.bodyFontSize,
        lineHeightRatio: theme.bodyLineHeight
      });

      for (const line of lines) {
        const lineItem: PageLineItem = {
          type: "line",
          id: createId("line"),
          runs: line.runs,
          lineHeight: line.lineHeight
        };
        pushItem(lineItem, line.lineHeight, true);
      }

      const spacing = Math.max(0, node.spacingAfter ?? 14);
      if (spacing > 0) {
        pushItem(
          {
            type: "spacer",
            id: createId("spacer"),
            height: spacing
          },
          spacing,
          true
        );
      }
      continue;
    }

    const widthScale = Math.min(1, contentWidth / node.width);
    let renderWidth = Math.max(1, Math.round(node.width * widthScale));
    let renderHeight = Math.max(1, Math.round(node.height * widthScale));

    if (renderHeight > contentHeight) {
      const hScale = contentHeight / renderHeight;
      renderWidth = Math.max(1, Math.floor(renderWidth * hScale));
      renderHeight = Math.max(1, Math.floor(renderHeight * hScale));
      warnings.push(`图片 ${node.id} 超高，已自动缩放到单页最大高度`);
    }

    if (currentPage.usedHeight + renderHeight > contentHeight && currentPage.items.length > 0) {
      currentPage = createEmptyPage(pages.length + 1);
      pages.push(currentPage);
    }

    const imageItem: PageImageItem = {
      type: "image",
      id: createId("imgitem"),
      assetId: node.assetId,
      src: node.src,
      width: renderWidth,
      height: renderHeight,
      align: node.align,
      caption: node.caption
    };

    pushItem(imageItem, renderHeight, false);
    pushItem(
      {
        type: "spacer",
        id: createId("spacer"),
        height: 18
      },
      18,
      true
    );
  }

  return {
    pages,
    warnings
  };
}
