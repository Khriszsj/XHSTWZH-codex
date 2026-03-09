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
  await page.keyboard.type("字间距行高内边距调试文本 ABC 123");
  await sleep(600);

  await editor.click();
  await page.keyboard.press("Meta+A");

  const sliders = page.locator(".style-slider input[type='range']");
  const fontSlider = sliders.nth(0);
  const lineHeightSlider = sliders.nth(1);
  const letterSpacingSlider = sliders.nth(2);
  const paddingSlider = sliders.nth(3);

  await fontSlider.evaluate((el) => {
    const input = el;
    input.value = "24";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await lineHeightSlider.evaluate((el) => {
    const input = el;
    input.value = "2.1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await letterSpacingSlider.evaluate((el) => {
    const input = el;
    input.value = "4";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await paddingSlider.evaluate((el) => {
    const input = el;
    input.value = "18";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await sleep(1200);

  const res = await context.request.get(`${baseURL}/api/projects/${projectId}`);
  if (!res.ok()) {
    throw new Error(`读取项目失败 status=${res.status()}`);
  }
  const payload = await res.json();
  const textNodes = collectTextNodes(payload.project.doc);

  const hit = {
    fontSize: textNodes.some((n) => Number(n.marks?.fontSize) === 24),
    lineHeight: textNodes.some((n) => Number(n.marks?.lineHeight) >= 2),
    letterSpacing: textNodes.some((n) => Number(n.marks?.letterSpacing) >= 3.5),
    paddingInline: textNodes.some((n) => Number(n.marks?.paddingInline) >= 17)
  };

  const sample = textNodes.slice(0, 4).map((n) => n.marks || {});

  console.log(
    JSON.stringify(
      {
        projectId,
        hit,
        sample
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
