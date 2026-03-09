import fs from "node:fs";
import path from "node:path";
import type { PageItem, PageRender, Template, TextMark, ThemeVars } from "./types";
import { getAsset } from "./db";
import { resolveExistingAssetPath } from "./storage";

function escapeHtml(source: string): string {
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function styleFromMarks(marks?: TextMark): string {
  const styles: string[] = ["white-space:pre"];

  if (marks?.bold) {
    styles.push("font-weight:700");
  }
  if (marks?.color) {
    styles.push(`color:${marks.color}`);
  }
  if (marks?.fontSize) {
    styles.push(`font-size:${marks.fontSize}px`);
  }
  if (marks?.lineHeight) {
    styles.push(`line-height:${marks.lineHeight}`);
  }
  if (marks?.letterSpacing || marks?.letterSpacing === 0) {
    styles.push(`letter-spacing:${marks.letterSpacing}px`);
  }
  if (marks?.paddingInline) {
    styles.push(`padding-left:${marks.paddingInline}px`);
    styles.push(`padding-right:${marks.paddingInline}px`);
    styles.push("display:inline-block");
  }

  return styles.join(";");
}

async function resolveImageSource(src: string, assetId: string): Promise<string> {
  if (src.startsWith("data:")) {
    return src;
  }

  const asset = getAsset(assetId);
  if (!asset) {
    return src;
  }

  const resolvedPath = resolveExistingAssetPath(asset);
  if (!resolvedPath) {
    return src;
  }

  const fileBuffer = await fs.promises.readFile(resolvedPath);
  const ext = path.extname(resolvedPath).replace(".", "").toLowerCase();
  const mime = ext === "jpg" ? "jpeg" : ext;

  return `data:image/${mime};base64,${fileBuffer.toString("base64")}`;
}

export async function renderPagesHtml(params: {
  title: string;
  pages: PageRender[];
  template: Template;
  theme: ThemeVars;
}): Promise<string> {
  const { title, pages, template, theme } = params;

  const pageHtml = await Promise.all(
    pages.map(async (page) => {
      const itemHtml = await Promise.all(
        page.items.map(async (item: PageItem) => {
          if (item.type === "spacer") {
            return `<div style="height:${item.height}px"></div>`;
          }

          if (item.type === "image") {
            const src = await resolveImageSource(item.src, item.assetId);
            const justify =
              item.align === "left"
                ? "flex-start"
                : item.align === "right"
                  ? "flex-end"
                  : "center";

            return `<div style="display:flex;justify-content:${justify}"><img src="${src}" style="width:${item.width}px;height:${item.height}px;object-fit:contain;border-radius:10px;display:block" /></div>`;
          }

          const spans = item.runs
            .map((run) => `<span style="${styleFromMarks(run.marks)}">${escapeHtml(run.text)}</span>`)
            .join("");

          return `<div style="min-height:${item.lineHeight}px;line-height:${item.lineHeight}px;font-size:${theme.bodyFontSize}px;color:${theme.textColor};font-family:${theme.fontFamily};white-space:pre;overflow:hidden;word-break:normal">${spans}</div>`;
        })
      );

      return `<section class="xhs-page" data-page="${page.pageNo}">
  <div class="xhs-content">${itemHtml.join("")}</div>
  <footer class="xhs-footer">${escapeHtml(theme.footerSignature)}</footer>
</section>`;
    })
  );

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: only light;
    }
    body {
      margin: 0;
      padding: 24px;
      background: #f3f4f6;
      font-family: ${theme.fontFamily};
      display: flex;
      flex-wrap: wrap;
      gap: 18px;
    }
    .xhs-page {
      width: ${template.canvasWidth}px;
      height: ${template.canvasHeight}px;
      box-sizing: border-box;
      background: ${theme.pageBackground};
      border-radius: 32px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      border: 1px solid rgba(0, 0, 0, 0.08);
      box-shadow: 0 12px 30px rgba(17, 24, 39, 0.18);
    }
    .xhs-content {
      flex: 1;
      padding: ${theme.pagePaddingTop}px ${theme.pagePaddingRight}px ${theme.pagePaddingBottom}px ${theme.pagePaddingLeft}px;
      box-sizing: border-box;
      overflow: hidden;
    }
    .xhs-footer {
      padding: 0 ${theme.pagePaddingRight}px 32px;
      color: ${theme.secondaryColor};
      font-size: 24px;
      text-align: right;
      font-family: ${theme.fontFamily};
    }
  </style>
</head>
<body>
${pageHtml.join("\n")}
</body>
</html>`;
}
