import { chromium } from "playwright";

const baseURL = process.env.BASE_URL || "http://localhost:3000";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

function collectTextNodes(doc) {
  return doc.nodes
    .filter((n) => n.type === "paragraph")
    .flatMap((p) => p.children.filter((c) => c.type === "text"));
}

try {
  await page.goto(baseURL, { waitUntil: "networkidle", timeout: 60000 });
  const editor = page.locator(".editor-canvas");
  await editor.waitFor({ timeout: 30000 });

  const projectId = await page.locator(".field-inline select").inputValue();
  await editor.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.type("基线文本测试");
  await sleep(500);

  await editor.click();
  await page.keyboard.press("Meta+A");
  await page.getByRole("button", { name: "加粗" }).click();
  await sleep(1200);

  const html = await page.locator(".editor-canvas").evaluate((el) => el.innerHTML);
  const rangeInfo = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      return { hasSelection: false };
    }
    const r = sel.getRangeAt(0);
    return {
      hasSelection: true,
      collapsed: r.collapsed,
      startContainer: r.startContainer.nodeName,
      endContainer: r.endContainer.nodeName
    };
  });

  const res = await context.request.get(`${baseURL}/api/projects/${projectId}`);
  const payload = await res.json();
  const textNodes = collectTextNodes(payload.project.doc);
  const boldCount = textNodes.filter((n) => n.marks?.bold).length;

  console.log(
    JSON.stringify(
      {
        projectId,
        rangeInfo,
        htmlHas700: html.includes("font-weight:700"),
        htmlHas400: html.includes("font-weight:400"),
        boldCount,
        sample: textNodes.slice(0, 3)
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
