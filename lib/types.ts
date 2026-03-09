export type Align = "left" | "center" | "right";

export interface TextMark {
  bold?: boolean;
  color?: string;
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  paddingInline?: number;
}

export interface TextNode {
  type: "text";
  id: string;
  text: string;
  marks?: TextMark;
}

export interface HardBreakNode {
  type: "hardBreak";
  id: string;
}

export type InlineNode = TextNode | HardBreakNode;

export interface ParagraphNode {
  type: "paragraph";
  id: string;
  children: InlineNode[];
  spacingAfter?: number;
}

export interface ImageNode {
  type: "image";
  id: string;
  assetId: string;
  src: string;
  width: number;
  height: number;
  align: Align;
  caption?: string;
}

export type DocNode = ParagraphNode | ImageNode;

export interface RichDoc {
  id: string;
  title: string;
  nodes: DocNode[];
  updatedAt: number;
}

export interface ThemeVars {
  primaryColor: string;
  secondaryColor: string;
  pageBackground: string;
  textColor: string;
  accentColor: string;
  fontFamily: string;
  bodyFontSize: number;
  bodyLineHeight: number;
  pagePaddingTop: number;
  pagePaddingRight: number;
  pagePaddingBottom: number;
  pagePaddingLeft: number;
  footerSignature: string;
  imageStylePreset?: string;
}

export interface Template {
  id: string;
  name: string;
  canvasWidth: number;
  canvasHeight: number;
  coverTitleFontSize: number;
  coverSubtitleFontSize: number;
  defaultTheme: ThemeVars;
}

export interface Snapshot {
  id: string;
  at: number;
  doc: RichDoc;
}

export interface Project {
  id: string;
  title: string;
  templateId: string;
  themeVars: ThemeVars;
  doc: RichDoc;
  createdAt: number;
  updatedAt: number;
  snapshots: Snapshot[];
}

export interface Asset {
  id: string;
  projectId: string;
  type: string;
  width: number;
  height: number;
  localPath: string;
  hash: string;
  createdAt: number;
}

export interface TextRun {
  text: string;
  marks?: TextMark;
}

export interface PageLineItem {
  type: "line";
  id: string;
  runs: TextRun[];
  lineHeight: number;
}

export interface PageSpacerItem {
  type: "spacer";
  id: string;
  height: number;
}

export interface PageImageItem {
  type: "image";
  id: string;
  assetId: string;
  src: string;
  width: number;
  height: number;
  align: Align;
  caption?: string;
}

export type PageItem = PageLineItem | PageSpacerItem | PageImageItem;

export interface PageRender {
  pageNo: number;
  items: PageItem[];
  usedHeight: number;
}

export interface PaginationResult {
  pages: PageRender[];
  warnings: string[];
}

export interface EditorOperation {
  type:
    | "setParagraphMark"
    | "appendHardBreak"
    | "setParagraphSpacing"
    | "setParagraphTextColor"
    | "setParagraphFontSize";
  paragraphIndex: number;
  payload?: Record<string, string | number | boolean>;
}

export interface EditorCommandResult {
  intent: string;
  confidence: number;
  operations: EditorOperation[];
}

export interface ExportBundle {
  projectId: string;
  imagePaths: string[];
  publishMdPath: string;
  metaPath: string;
  zipPath: string;
  createdAt: number;
}
