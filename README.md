# 小红书长文转图工作台

本项目是一个本地运行的 Next.js 工具，面向小红书长文创作者，支持：

- 富文本编辑（加粗、字号、颜色、换行、空格保留）
- 编辑区插图（上传 / 粘贴 / 拖拽）
- mac 输入法 emoji 直接编辑并导出
- 对话式自然语言排版命令（本地规则引擎）
- 自动分页预览（1080x1440）
- 导出发布包（PNG 图集 + publish.md + meta.json + zip）
- 单页图片下载

## 1. 环境要求

- Node.js >= 20
- pnpm >= 9（或 npm）
- Playwright Chromium（用于导出图片）

## 2. 启动步骤

```bash
pnpm install
pnpm exec playwright install chromium
pnpm dev
```

浏览器打开 `http://localhost:3000`。

## 3. 目录说明

- `app/`：Next.js 页面与 API
- `components/`：编辑器与分页预览
- `lib/`：文档模型、分页算法、导出引擎、规则引擎、SQLite 数据层
- `storage/`：本地数据库、导出文件、素材文件、风险词词库

## 4. 关键 API

- `POST /api/assets/upload`：上传图片素材
- `POST /api/editor/command`：自然语言排版命令解析
- `POST /api/paginate`：分页计算
- `POST /api/export`：导出整包 zip
- `GET /api/export/page/:projectId/:pageNo`：导出单页 PNG
- `PUT /api/projects/:id/content`：保存 RichDoc

## 5. 注意事项

- 所有文章与素材默认本地存储，不上传云端。
- 当前导出依赖 Playwright；若 Chromium 未安装会导出失败。
- 插图当前支持 PNG/JPG/WebP（静态图）。
