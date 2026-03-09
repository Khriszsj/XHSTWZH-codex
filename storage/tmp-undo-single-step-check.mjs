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
  await page.locator(".editor-canvas").waitFor({ timeout: 30000 });

  const projectId = await page.locator(".field-inline select").inputValue();
  const editor = page.locator(".editor-canvas");

  await editor.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.type("撤销单步校验文本");
  await sleep(800);

  await editor.click();
  await page.keyboard.press("Meta+A");
  const fontSlider = page.locator(".style-slider input[type='range']").first();
  await fontSlider.evaluate((el) => {
    const input = el;
    input.value = "52";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(900);

  const afterChange = await context.request.get(`${baseURL}/api/projects/${projectId}`);
  if (!afterChange.ok()) {
    throw new Error(`读取项目失败 status=${afterChange.status()}`);
  }
  const changedDoc = (await afterChange.json()).project.doc;
  const has52 = collectTextNodes(changedDoc).some((n) => Number(n.marks?.fontSize) === 52);
  if (!has52) {
    throw new Error("调整字号后未写入 52px");
  }

  await page.getByRole("button", { name: "撤销" }).click();
  await sleep(1000);

  const afterUndo = await context.request.get(`${baseURL}/api/projects/${projectId}`);
  if (!afterUndo.ok()) {
    throw new Error(`读取项目失败 status=${afterUndo.status()}`);
  }
  const undoDoc = (await afterUndo.json()).project.doc;
  const still52 = collectTextNodes(undoDoc).some((n) => Number(n.marks?.fontSize) === 52);
  if (still52) {
    throw new Error("单次撤销后字号仍为 52px，仍需多次点击");
  }

  console.log(
    JSON.stringify(
      {
        pass: true,
        projectId,
        changedFontSize: 52,
        singleUndoEffective: true
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
