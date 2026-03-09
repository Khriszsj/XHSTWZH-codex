import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const baseURL = process.env.BASE_URL || "http://localhost:3000";
const workdir = process.env.WORKDIR || process.cwd();
const imagePath = path.join(workdir, "storage", "tmp-test.png");

if (!fs.existsSync(imagePath)) {
  throw new Error(`测试图片不存在: ${imagePath}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

function collectText(node) {
  if (!node || node.type !== "paragraph") {
    return "";
  }
  return (node.children || [])
    .filter((child) => child.type === "text")
    .map((child) => child.text || "")
    .join("");
}

try {
  await page.goto(baseURL, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator(".editor-canvas").waitFor({ timeout: 30000 });

  const projectId = await page.locator(".field-inline select").inputValue();
  const editor = page.locator(".editor-canvas");

  const unit = "这是用于验证长段落中段插图切分能力的测试文本。";
  const longText = Array.from({ length: 280 }, () => unit).join("");
  const marker = `[[MID_ANCHOR_${Date.now()}]]`;

  await editor.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.type(longText);
  await sleep(1200);

  await page.evaluate((token) => {
    const paragraph = document.querySelector(".editor-canvas p");
    if (!paragraph) {
      throw new Error("未找到段落节点");
    }

    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    const textNode = walker.nextNode();
    if (!textNode) {
      throw new Error("未找到段落文本节点");
    }

    const text = (textNode.nodeValue || "");
    const offset = Math.floor(text.length * 0.5);
    const range = document.createRange();
    range.setStart(textNode, Math.max(0, Math.min(offset, text.length)));
    range.collapse(true);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    document.execCommand("insertText", false, token);
  }, marker);

  await sleep(250);

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "插入图片" }).click()
  ]);
  await chooser.setFiles(imagePath);
  await sleep(2200);

  const projectRes = await context.request.get(`${baseURL}/api/projects/${projectId}`);
  if (!projectRes.ok()) {
    throw new Error(`读取项目失败 status=${projectRes.status()}`);
  }
  const payload = await projectRes.json();
  const doc = payload.project.doc;
  const nodes = doc.nodes || [];

  const markerParagraphIndex = nodes.findIndex((node) => collectText(node).includes(marker));
  if (markerParagraphIndex < 0) {
    throw new Error("文档中未找到锚点段落");
  }

  const imageIndex = nodes.findIndex((node, index) => index > markerParagraphIndex && node.type === "image");
  if (imageIndex < 0) {
    throw new Error("锚点后未找到图片节点");
  }
  const insertedImage = nodes[imageIndex];

  const trailingParagraph = nodes[imageIndex + 1];
  if (!trailingParagraph || trailingParagraph.type !== "paragraph") {
    throw new Error("图片后未找到切分后的尾段落");
  }

  const trailingText = collectText(trailingParagraph).trim();
  if (!trailingText) {
    throw new Error("图片后尾段落为空，切分失败");
  }

  const paginateRes = await context.request.post(`${baseURL}/api/paginate`, {
    data: {
      doc: payload.project.doc,
      templateId: payload.project.templateId,
      themeVars: payload.project.themeVars
    }
  });
  if (!paginateRes.ok()) {
    throw new Error(`分页请求失败 status=${paginateRes.status()}`);
  }
  const paginatePayload = await paginateRes.json();
  const pageHit = (paginatePayload.pages || []).find((item) =>
    (item.items || []).some((entry) => entry.type === "image" && entry.assetId === insertedImage.assetId)
  );
  if (!pageHit) {
    throw new Error(`分页结果未包含插入图片 assetId=${insertedImage.assetId}`);
  }

  console.log(
    JSON.stringify(
      {
        pass: true,
        projectId,
        markerParagraphIndex,
        imageIndex,
        hasTrailingParagraph: true,
        trailingTextSample: trailingText.slice(0, 24),
        pageNo: pageHit.pageNo
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
