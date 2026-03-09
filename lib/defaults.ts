import type { RichDoc, Template, ThemeVars } from "./types";
import { createId } from "./id";

export const DEFAULT_THEME: ThemeVars = {
  primaryColor: "#1f2937",
  secondaryColor: "#6b7280",
  pageBackground: "#fffaf4",
  textColor: "#111827",
  accentColor: "#ef4444",
  fontFamily:
    "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Apple Color Emoji', sans-serif",
  bodyFontSize: 36,
  bodyLineHeight: 1.6,
  pagePaddingTop: 88,
  pagePaddingRight: 88,
  pagePaddingBottom: 88,
  pagePaddingLeft: 88,
  footerSignature: "@你的账号",
  imageStylePreset: "soft-shadow"
};

export const TEMPLATES: Template[] = [
  {
    id: "warm-notes",
    name: "暖调笔记",
    canvasWidth: 1080,
    canvasHeight: 1440,
    coverTitleFontSize: 72,
    coverSubtitleFontSize: 40,
    defaultTheme: DEFAULT_THEME
  },
  {
    id: "minimal-white",
    name: "极简白",
    canvasWidth: 1080,
    canvasHeight: 1440,
    coverTitleFontSize: 68,
    coverSubtitleFontSize: 36,
    defaultTheme: {
      ...DEFAULT_THEME,
      pageBackground: "#ffffff",
      primaryColor: "#111827",
      secondaryColor: "#4b5563",
      accentColor: "#dc2626"
    }
  }
];

export function createDefaultDoc(title = "未命名笔记"): RichDoc {
  return {
    id: createId("doc"),
    title,
    nodes: [
      {
        type: "paragraph",
        id: createId("para"),
        children: [
          {
            type: "text",
            id: createId("txt"),
            text: "在这里开始写作，支持文字样式、换行、空格、emoji 和插图。"
          }
        ]
      }
    ],
    updatedAt: Date.now()
  };
}

export function getTemplate(templateId?: string): Template {
  return (
    TEMPLATES.find((item) => item.id === templateId) ??
    TEMPLATES[0]
  );
}
