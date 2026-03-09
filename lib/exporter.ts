import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { chromium } from "playwright";
import { registerExportJob } from "./db";
import { sha1 } from "./hash";
import { renderPagesHtml } from "./render";
import { EXPORT_DIR, ensureDir } from "./storage";
import type { ExportBundle, PageRender, Project, Template, ThemeVars } from "./types";

async function capturePageImages(params: {
  html: string;
  outputDir: string;
  filePrefix: string;
}): Promise<string[]> {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1220, height: 1600 } });
    await page.setContent(params.html, { waitUntil: "networkidle" });

    const handles = await page.$$(".xhs-page");
    const paths: string[] = [];

    for (let index = 0; index < handles.length; index += 1) {
      const handle = handles[index];
      const filePath = path.join(
        params.outputDir,
        `${params.filePrefix}${String(index + 1).padStart(3, "0")}.png`
      );

      await handle.screenshot({ path: filePath, type: "png" });
      paths.push(filePath);
    }

    return paths;
  } finally {
    await browser.close();
  }
}

export async function exportProjectBundle(params: {
  project: Project;
  pages: PageRender[];
  template: Template;
  theme: ThemeVars;
  suggestions: { titles: string[]; tags: string[] };
  complianceIssues: Array<{ word: string; count: number; suggestion: string }>;
}): Promise<ExportBundle & { exportId: string }> {
  const stamp = Date.now();
  const exportFolderName = `${params.project.id}-${stamp}`;
  const outputDir = path.join(EXPORT_DIR, exportFolderName);
  ensureDir(outputDir);

  const html = await renderPagesHtml({
    title: params.project.title,
    pages: params.pages,
    template: params.template,
    theme: params.theme
  });

  const imagePaths = await capturePageImages({
    html,
    outputDir,
    filePrefix: ""
  });

  const publishMdPath = path.join(outputDir, "publish.md");
  const metaPath = path.join(outputDir, "meta.json");
  const zipPath = path.join(EXPORT_DIR, `${exportFolderName}.zip`);

  const publishContent = [
    `# ${params.project.title}`,
    "",
    "## 标题候选",
    ...params.suggestions.titles.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## 标签建议",
    params.suggestions.tags.join(" "),
    "",
    "## 发布提示",
    "- 图片顺序已按编号导出。",
    "- 导出后先检查风险词提示再发布。"
  ].join("\n");

  await fs.promises.writeFile(publishMdPath, publishContent, "utf8");

  const imageHashes: Record<string, string> = {};
  for (const imagePath of imagePaths) {
    const file = await fs.promises.readFile(imagePath);
    imageHashes[path.basename(imagePath)] = sha1(file);
  }

  const meta = {
    projectId: params.project.id,
    templateId: params.project.templateId,
    pageCount: imagePaths.length,
    exportedAt: stamp,
    complianceIssues: params.complianceIssues,
    imageHashes
  };

  await fs.promises.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");

  const zip = new JSZip();

  for (const imagePath of imagePaths) {
    const content = await fs.promises.readFile(imagePath);
    zip.file(path.basename(imagePath), content);
  }

  zip.file("publish.md", await fs.promises.readFile(publishMdPath));
  zip.file("meta.json", await fs.promises.readFile(metaPath));

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  await fs.promises.writeFile(zipPath, zipBuffer);

  const exportId = registerExportJob(params.project.id, zipPath);

  return {
    exportId,
    projectId: params.project.id,
    imagePaths,
    publishMdPath,
    metaPath,
    zipPath,
    createdAt: stamp
  };
}

export async function exportSinglePage(params: {
  projectId: string;
  projectTitle: string;
  pages: PageRender[];
  template: Template;
  theme: ThemeVars;
  pageNo: number;
}): Promise<{ filePath: string; fileName: string; hash: string }> {
  const page = params.pages.find((item) => item.pageNo === params.pageNo);
  if (!page) {
    throw new Error("Page not found");
  }

  const html = await renderPagesHtml({
    title: params.projectTitle,
    pages: [page],
    template: params.template,
    theme: params.theme
  });

  const outputDir = path.join(EXPORT_DIR, `${params.projectId}-single`);
  ensureDir(outputDir);

  const fileName = `${params.projectId}-${String(params.pageNo).padStart(3, "0")}.png`;
  const filePath = path.join(outputDir, fileName);

  const [capturedPath] = await capturePageImages({
    html,
    outputDir,
    filePrefix: `${params.projectId}-${String(params.pageNo).padStart(3, "0")}-`
  });

  await fs.promises.copyFile(capturedPath, filePath);
  const buffer = await fs.promises.readFile(filePath);

  return {
    filePath,
    fileName,
    hash: sha1(buffer)
  };
}
