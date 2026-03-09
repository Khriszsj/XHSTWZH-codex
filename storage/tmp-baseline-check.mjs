import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const baseURL = process.env.BASE_URL || 'http://localhost:3001';
const workdir = process.env.WORKDIR || process.cwd();
const imagePath = path.join(workdir, 'storage', 'tmp-test.png');

if (!fs.existsSync(imagePath)) {
  throw new Error(`测试图片不存在: ${imagePath}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function collectTextNodes(doc) {
  return doc.nodes
    .filter((n) => n.type === 'paragraph')
    .flatMap((p) => p.children.filter((c) => c.type === 'text'));
}

function hasHardBreak(doc) {
  return doc.nodes
    .filter((n) => n.type === 'paragraph')
    .some((p) => p.children.some((c) => c.type === 'hardBreak'));
}

const result = {
  baseURL,
  checks: [],
  startedAt: new Date().toISOString()
};

async function runCheck(id, title, fn) {
  try {
    const detail = await fn();
    result.checks.push({ id, title, pass: true, detail });
  } catch (error) {
    result.checks.push({
      id,
      title,
      pass: false,
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();

async function getProjectId() {
  return page.locator('.field-inline select').inputValue();
}

async function getProjectDoc(projectId) {
  const res = await context.request.get(`${baseURL}/api/projects/${projectId}`);
  if (!res.ok()) {
    throw new Error(`读取项目失败 status=${res.status()}`);
  }
  const payload = await res.json();
  return payload.project.doc;
}

async function getProject(projectId) {
  const res = await context.request.get(`${baseURL}/api/projects/${projectId}`);
  if (!res.ok()) {
    throw new Error(`读取项目失败 status=${res.status()}`);
  }
  const payload = await res.json();
  return payload.project;
}

try {
  await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('text=小红书长文转图工作台').first().waitFor({ timeout: 30000 });

  const projectSelect = page.locator('.field-inline select');
  await projectSelect.waitFor({ timeout: 20000 });

  const initialProjectId = await projectSelect.inputValue();

  await runCheck('B-01', '新建项目/切换项目/自动保存', async () => {
    const initialCount = await projectSelect.locator('option').count();

    await page.getByRole('button', { name: '新建项目' }).click();
    await page.waitForFunction(
      ({ selector, expected }) => {
        const node = document.querySelector(selector);
        if (!node) return false;
        return node.querySelectorAll('option').length >= expected;
      },
      { selector: '.field-inline select', expected: initialCount + 1 },
      { timeout: 30000 }
    );

    const afterCreateCount = await projectSelect.locator('option').count();
    if (afterCreateCount < initialCount + 1) {
      throw new Error(`项目数量未增加: ${initialCount} -> ${afterCreateCount}`);
    }

    const options = await projectSelect.locator('option').evaluateAll((nodes) =>
      nodes.map((n) => ({ value: n.value, text: n.textContent?.trim() || '' }))
    );

    if (!options.some((o) => o.value === initialProjectId)) {
      throw new Error('原项目ID不在下拉列表，无法验证切换');
    }

    await projectSelect.selectOption(initialProjectId);
    await sleep(500);

    const marker = `基线保存测试-${Date.now()}`;
    const titleInput = page.locator('.title-field input');
    await titleInput.fill(marker);
    await sleep(1600);

    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.title-field input').waitFor({ timeout: 20000 });

    const saved = await page.locator('.title-field input').inputValue();
    if (saved !== marker) {
      throw new Error(`自动保存失败，期望=${marker} 实际=${saved}`);
    }

    return { initialCount, afterCreateCount, marker };
  });

  await runCheck('B-02', '富文本编辑（加粗/字号/颜色/换行/空格）', async () => {
    const editor = page.locator('.editor-canvas');
    await editor.click();
    await page.keyboard.press('Meta+A');
    await page.keyboard.type('基线文本测试');
    await sleep(1200);

    const projectId = await getProjectId();
    let doc = await getProjectDoc(projectId);
    let textNodes = collectTextNodes(doc);

    // Normalize to a deterministic non-bold start state before testing toggle.
    if (textNodes.some((n) => n.marks?.bold)) {
      await editor.click();
      await page.keyboard.press('Meta+A');
      await page.getByRole('button', { name: '加粗' }).click();
      await sleep(1200);

      doc = await getProjectDoc(projectId);
      textNodes = collectTextNodes(doc);
      if (textNodes.some((n) => n.marks?.bold)) {
        throw new Error('加粗归一化失败：初始内容仍处于加粗状态');
      }
    }

    await editor.click();
    await page.keyboard.press('Meta+A');
    await page.getByRole('button', { name: '加粗' }).click();
    await sleep(1200);

    doc = await getProjectDoc(projectId);
    textNodes = collectTextNodes(doc);
    if (!textNodes.some((n) => n.marks?.bold)) {
      throw new Error('点击加粗后，文档未出现 bold 标记');
    }

    await editor.click();
    await page.keyboard.press('Meta+A');
    await page.getByRole('button', { name: '加粗' }).click();
    await sleep(1200);

    doc = await getProjectDoc(projectId);
    textNodes = collectTextNodes(doc);
    if (textNodes.some((n) => n.marks?.bold)) {
      throw new Error('再次点击加粗后，仍存在 bold 标记');
    }

    await editor.click();
    await page.keyboard.press('Meta+A');
    const fontSlider = page.locator('.style-slider input[type="range"]').first();
    await fontSlider.evaluate((el) => {
      el.value = '40';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(1200);

    doc = await getProjectDoc(projectId);
    textNodes = collectTextNodes(doc);
    if (!textNodes.some((n) => Number(n.marks?.fontSize) === 40)) {
      throw new Error('字号未写入为 40px');
    }

    await editor.click();
    await page.keyboard.press('Meta+A');
    await page.locator('.color-swatch-btn', { hasText: '赤' }).first().click();
    await sleep(1200);

    doc = await getProjectDoc(projectId);
    textNodes = collectTextNodes(doc);
    if (!textNodes.some((n) => String(n.marks?.color || '').toLowerCase() === '#dc2626')) {
      throw new Error('颜色未写入为 #dc2626');
    }

    await editor.click();
    await page.keyboard.press('End');
    await page.getByRole('button', { name: '换行' }).click();
    await page.keyboard.type('A  B');
    await sleep(1200);

    doc = await getProjectDoc(projectId);
    const allText = collectTextNodes(doc).map((n) => n.text).join('\n');
    if (!allText.includes('A  B')) {
      throw new Error('双空格未写入文档');
    }
    if (!hasHardBreak(doc)) {
      throw new Error('换行未写入 hardBreak');
    }

    return { projectId };
  });

  await runCheck('B-03', '插图上传/粘贴/拖拽/缩放', async () => {
    const projectId = await getProjectId();

    let doc = await getProjectDoc(projectId);
    const beforeAssetIds = new Set(
      doc.nodes.filter((n) => n.type === 'image').map((n) => n.assetId)
    );
    const beforeUploadCount = doc.nodes.filter((n) => n.type === 'image').length;

    const markerToken = `[[IMG_ANCHOR_${Date.now()}]]`;
    const paragraphs = page.locator('.editor-canvas p');
    const paragraphCount = await paragraphs.count();
    const anchorIndex = paragraphCount > 2 ? Math.floor(paragraphCount * 0.7) : 0;
    const anchorParagraph = paragraphs.nth(anchorIndex);
    await anchorParagraph.scrollIntoViewIfNeeded();
    await anchorParagraph.click({ position: { x: 12, y: 8 } });
    await page.keyboard.type(markerToken);
    await sleep(700);

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: '插入图片' }).click()
    ]);
    await chooser.setFiles(imagePath);

    let afterUploadCount = beforeUploadCount;
    const started = Date.now();
    while (Date.now() - started < 20000) {
      doc = await getProjectDoc(projectId);
      afterUploadCount = doc.nodes.filter((n) => n.type === 'image').length;
      if (afterUploadCount > beforeUploadCount) {
        break;
      }
      await sleep(350);
    }
    if (afterUploadCount <= beforeUploadCount) {
      throw new Error(`上传后图片节点未增加: ${beforeUploadCount} -> ${afterUploadCount}`);
    }

    const markerIdx = doc.nodes.findIndex(
      (n) =>
        n.type === 'paragraph' &&
        n.children.some((c) => c.type === 'text' && c.text.includes(markerToken))
    );
    const firstInserted = doc.nodes
      .map((n, idx) => ({ n, idx }))
      .find(({ n }) => n.type === 'image' && !beforeAssetIds.has(n.assetId));
    if (!firstInserted) {
      throw new Error('插图后未找到新增图片节点');
    }
    if (markerIdx >= 0) {
      if (firstInserted.idx > markerIdx + 5) {
        throw new Error(
          `插图位置异常：锚点段落 idx=${markerIdx}，图片 idx=${firstInserted.idx}（疑似被置底）`
        );
      }
      const hasTrailingParagraph = doc.nodes
        .slice(firstInserted.idx + 1)
        .some(
          (n) =>
            n.type === 'paragraph' &&
            n.children.some((c) => c.type === 'text' && String(c.text || '').trim().length > 0)
        );
      if (firstInserted.idx >= doc.nodes.length - 2 && !hasTrailingParagraph) {
        throw new Error(
          `插图疑似置底：锚点段落 idx=${markerIdx}，图片 idx=${firstInserted.idx}，总节点=${doc.nodes.length}`
        );
      }
    }

    await page.locator('.editor-canvas figure img').last().click();
    await page.locator('text=图片尺寸').first().waitFor({ timeout: 5000 });

    const imageSizeSlider = page.locator('text=图片尺寸').locator('..').locator('input[type="range"]');
    await imageSizeSlider.evaluate((el) => {
      el.value = '60';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(1200);

    doc = await getProjectDoc(projectId);
    const images = doc.nodes.filter((n) => n.type === 'image');
    const lastImage = images[images.length - 1];
    if (!lastImage || Number(lastImage.width) <= 0 || Number(lastImage.height) <= 0) {
      throw new Error('缩放后图片尺寸无效');
    }

    const currentProject = await getProject(projectId);
    const paginateRes = await context.request.post(`${baseURL}/api/paginate`, {
      data: {
        doc: currentProject.doc,
        templateId: currentProject.templateId,
        themeVars: currentProject.themeVars
      }
    });
    if (!paginateRes.ok()) {
      throw new Error(`分页请求失败 status=${paginateRes.status()}`);
    }
    const paginatePayload = await paginateRes.json();
    const targetPage = (paginatePayload.pages || []).find((p) =>
      (p.items || []).some((item) => item.type === 'image' && item.assetId === lastImage.assetId)
    );
    if (!targetPage) {
      throw new Error(`分页中未找到刚插入图片 assetId=${lastImage.assetId}`);
    }

    const pageButton = page.locator('.preview-mini-item', {
      hasText: String(targetPage.pageNo)
    }).first();
    if (await pageButton.count()) {
      await pageButton.click();
      await sleep(300);
    }

    const previewLoaded = await page.evaluate((assetId) => {
      const imgs = Array.from(document.querySelectorAll('.preview-main .xhs-preview-page img'));
      if (!imgs.length) {
        return false;
      }
      const target = imgs.find((img) => (img.getAttribute('src') || '').includes(assetId));
      if (!target) {
        return false;
      }
      return target.complete && target.naturalWidth > 2 && target.naturalHeight > 2;
    }, lastImage.assetId);

    if (!previewLoaded) {
      throw new Error(`预览区图片未成功加载 assetId=${lastImage.assetId}`);
    }

    const fileBase64 = fs.readFileSync(imagePath).toString('base64');

    const beforePaste = images.length;
    await page.evaluate(async (b64) => {
      const editor = document.querySelector('.editor-canvas');
      if (!editor) return;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'paste.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      });
      editor.dispatchEvent(event);
    }, fileBase64);
    await sleep(1600);

    doc = await getProjectDoc(projectId);
    const afterPaste = doc.nodes.filter((n) => n.type === 'image').length;
    if (afterPaste <= beforePaste) {
      throw new Error(`粘贴后图片节点未增加: ${beforePaste} -> ${afterPaste}`);
    }

    const beforeDrop = afterPaste;
    await page.evaluate(async (b64) => {
      const editor = document.querySelector('.editor-canvas');
      if (!editor) return;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'drop.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt
      });
      editor.dispatchEvent(dropEvent);
    }, fileBase64);
    await sleep(1600);

    doc = await getProjectDoc(projectId);
    const afterDrop = doc.nodes.filter((n) => n.type === 'image').length;
    if (afterDrop <= beforeDrop) {
      throw new Error(`拖拽后图片节点未增加: ${beforeDrop} -> ${afterDrop}`);
    }

    return { beforeUploadCount, afterUploadCount, afterPaste, afterDrop, previewSyncAssetId: lastImage.assetId };
  });

  await runCheck('B-04', '分页预览（1080×1440）', async () => {
    await page.locator('.preview-main .xhs-preview-page').first().waitFor({ timeout: 10000 });

    const canvasSize = await page.evaluate(() => {
      const node = document.querySelector('.preview-main .xhs-preview-page > div');
      if (!node) return null;
      const style = node.getAttribute('style') || '';
      const wm = style.match(/width:\s*(\d+)px/);
      const hm = style.match(/height:\s*(\d+)px/);
      return {
        width: wm ? Number(wm[1]) : NaN,
        height: hm ? Number(hm[1]) : NaN
      };
    });

    if (!canvasSize || canvasSize.width !== 1080 || canvasSize.height !== 1440) {
      throw new Error(`预览尺寸异常: ${JSON.stringify(canvasSize)}`);
    }

    const pagerText = await page.locator('.preview-pager span').innerText();
    if (!/第\s*\d+\s*\/\s*\d+\s*页/.test(pagerText)) {
      throw new Error(`分页器文案异常: ${pagerText}`);
    }

    return { canvasSize, pagerText };
  });

  await runCheck('B-05', '单页下载与整包导出', async () => {
    const projectId = await getProjectId();

    const single = await context.request.get(`${baseURL}/api/export/page/${projectId}/1`, {
      timeout: 120000
    });
    if (!single.ok()) {
      throw new Error(`单页导出失败: status=${single.status()}`);
    }

    const singleType = single.headers()['content-type'] || '';
    if (!singleType.includes('image/png')) {
      throw new Error(`单页导出类型异常: ${singleType}`);
    }

    const exportRes = await context.request.post(`${baseURL}/api/export`, {
      data: { projectId },
      timeout: 120000
    });

    if (!exportRes.ok()) {
      throw new Error(`整包导出失败: status=${exportRes.status()}`);
    }

    const exportPayload = await exportRes.json();
    if (!exportPayload.downloadUrl) {
      throw new Error('整包导出返回缺少 downloadUrl');
    }

    const zip = await context.request.get(`${baseURL}${exportPayload.downloadUrl}`, {
      timeout: 120000
    });
    if (!zip.ok()) {
      throw new Error(`下载zip失败: status=${zip.status()}`);
    }

    const zipType = zip.headers()['content-type'] || '';
    const zipBuffer = await zip.body();
    if (!zipType.includes('application/zip')) {
      throw new Error(`zip类型异常: ${zipType}`);
    }
    if (!zipBuffer || zipBuffer.length < 512) {
      throw new Error(`zip体积过小: ${zipBuffer?.length ?? 0}`);
    }

    return {
      projectId,
      singleType,
      zipType,
      zipBytes: zipBuffer.length,
      imageCount: exportPayload.imageCount
    };
  });

  await runCheck('B-06', '撤销/重做', async () => {
    const editor = page.locator('.editor-canvas');
    const beforeText = await editor.innerText();

    const token = `UNDO-${Date.now()}`;
    await editor.click();
    await page.keyboard.type(token);
    await sleep(400);

    const afterEdit = await editor.innerText();
    if (afterEdit.length <= beforeText.length) {
      throw new Error('编辑后内容长度未增加，无法验证撤销重做');
    }

    let afterUndo = afterEdit;
    let undoClicks = 0;
    for (let i = 0; i < 6; i += 1) {
      await page.getByRole('button', { name: '撤销' }).click();
      await sleep(400);
      afterUndo = await editor.innerText();
      undoClicks += 1;
      if (afterUndo.length < afterEdit.length) {
        break;
      }
    }
    if (afterUndo.length >= afterEdit.length) {
      throw new Error('连续撤销后内容仍未回退');
    }

    let afterRedo = afterUndo;
    let redoClicks = 0;
    for (let i = 0; i < 6; i += 1) {
      await page.getByRole('button', { name: '重做' }).click();
      await sleep(400);
      afterRedo = await editor.innerText();
      redoClicks += 1;
      if (afterRedo.length > afterUndo.length) {
        break;
      }
    }
    if (afterRedo.length <= afterUndo.length) {
      throw new Error('连续重做后内容未恢复');
    }

    return {
      beforeLen: beforeText.length,
      afterEditLen: afterEdit.length,
      afterUndoLen: afterUndo.length,
      afterRedoLen: afterRedo.length,
      undoClicks,
      redoClicks
    };
  });
} finally {
  await browser.close();
}

result.finishedAt = new Date().toISOString();
result.passed = result.checks.every((c) => c.pass);

console.log(JSON.stringify(result, null, 2));

if (!result.passed) {
  process.exitCode = 1;
}
