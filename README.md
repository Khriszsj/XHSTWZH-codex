# 小红书长文转图工作台
# Xiaohongshu Long-Form Post to Image Studio

本项目是一个本地运行的 Next.js 工具，面向小红书长文创作者，支持：
This project is a locally running Next.js tool for Xiaohongshu long-form content creators, with support for:

- 富文本编辑（加粗、字号、颜色、换行、空格保留）
  Rich text editing (bold, font size, color, line breaks, and preserved spaces)
- 编辑区插图（上传 / 粘贴 / 拖拽）
  Insert images into the editor (upload / paste / drag and drop)
- mac 输入法 emoji 直接编辑并导出
  Direct editing and export of emoji entered with the macOS input method
- 对话式自然语言排版命令（本地规则引擎）
  Conversational natural-language layout commands (local rule engine)
- 自动分页预览（1080x1440）
  Automatic paginated preview (1080x1440)
- 导出发布包（PNG 图集 + publish.md + meta.json + zip）
  Export a publishing bundle (PNG images + publish.md + meta.json + zip)
- 单页图片下载
  Single-page image download

## 1. 环境要求
## 1. Environment Requirements

- Node.js >= 20
- pnpm >= 9（或 npm）
  pnpm >= 9 (or npm)
- Playwright Chromium（用于导出图片）
  Playwright Chromium (used for image export)

## 2. 启动步骤
## 2. Getting Started

```bash
pnpm install
pnpm exec playwright install chromium
pnpm dev
```

浏览器打开 `http://localhost:3000`。
Open `http://localhost:3000` in your browser.

## 3. 目录说明
## 3. Directory Overview

- `app/`：Next.js 页面与 API
  `app/`: Next.js pages and API routes
- `components/`：编辑器与分页预览
  `components/`: Editor and paginated preview
- `lib/`：文档模型、分页算法、导出引擎、规则引擎、SQLite 数据层
  `lib/`: Document model, pagination algorithm, export engine, rule engine, and SQLite data layer
- `storage/`：本地数据库、导出文件、素材文件、风险词词库
  `storage/`: Local database, exported files, asset files, and risk-word dictionary

## 4. 关键 API
## 4. Key API Endpoints

- `POST /api/assets/upload`：上传图片素材
  `POST /api/assets/upload`: Upload image assets
- `POST /api/editor/command`：自然语言排版命令解析
  `POST /api/editor/command`: Parse natural-language layout commands
- `POST /api/paginate`：分页计算
  `POST /api/paginate`: Run pagination calculation
- `POST /api/export`：导出整包 zip
  `POST /api/export`: Export the full zip bundle
- `GET /api/export/page/:projectId/:pageNo`：导出单页 PNG
  `GET /api/export/page/:projectId/:pageNo`: Export a single page as PNG
- `PUT /api/projects/:id/content`：保存 RichDoc
  `PUT /api/projects/:id/content`: Save RichDoc content

## 5. 注意事项
## 5. Notes

- 所有文章与素材默认本地存储，不上传云端。
  All articles and assets are stored locally by default and are not uploaded to the cloud.
- 当前导出依赖 Playwright；若 Chromium 未安装会导出失败。
  Export currently depends on Playwright; export will fail if Chromium is not installed.
- 插图当前支持 PNG/JPG/WebP（静态图）。
  Inserted images currently support PNG/JPG/WebP (static images).
