"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { editorElementToRichDoc, richDocToEditorHtml } from "./editor-serializer";
import { normalizeHexColor } from "@/lib/color";
import { createId } from "@/lib/id";
import { isSupportedImageMimeType, SUPPORTED_IMAGE_EXTENSIONS } from "@/lib/image-file";
import type { RichDoc } from "@/lib/types";

interface RichEditorProps {
  projectId: string;
  doc: RichDoc;
  onDocChange: (doc: RichDoc) => void;
  onCommandFeedback: (message: string) => void;
}

interface ParagraphAnchorSnapshot {
  paragraphId: string;
  offset: number;
}

interface PendingInsertContext {
  anchor: ParagraphAnchorSnapshot | null;
  paragraphId: string | null;
  bookmarkId: string | null;
  createdAt: number;
}

const BODY_TEXT_COLOR = "#111827";

const COMMON_TEXT_COLORS = [
  { label: "正文", value: "#111827" },
  { label: "赤", value: "#dc2626" },
  { label: "橙", value: "#f97316" },
  { label: "黄", value: "#ca8a04" },
  { label: "绿", value: "#16a34a" },
  { label: "青", value: "#0891b2" },
  { label: "蓝", value: "#2563eb" },
  { label: "紫", value: "#7c3aed" }
] as const;

function placeCaretAfter(node: Node): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.setStartAfter(node);
  range.setEndAfter(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

function runExecCommand(command: string, value?: string): boolean {
  try {
    return document.execCommand(command, false, value);
  } catch {
    return false;
  }
}

function parseFontWeight(fontWeight: string): number {
  const normalized = (fontWeight || "").trim().toLowerCase();
  if (normalized === "bold") {
    return 700;
  }
  if (normalized === "normal") {
    return 400;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : 400;
}

function isBoldWeight(fontWeight: string): boolean {
  return parseFontWeight(fontWeight) >= 600;
}

function isNodeBold(node: Node | null): boolean {
  if (!node) {
    return false;
  }

  const element = node instanceof HTMLElement ? node : node.parentElement;
  if (!element) {
    return false;
  }

  const computed = window.getComputedStyle(element);
  return isBoldWeight(computed.fontWeight);
}

function toCssProperty(key: string): string {
  return key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function applyStyleMap(target: HTMLElement, style: Partial<CSSStyleDeclaration>): void {
  for (const [key, value] of Object.entries(style)) {
    if (!value) {
      continue;
    }
    target.style.setProperty(toCssProperty(key), String(value));
  }
}

function applyStyleDeep(target: Node, style: Partial<CSSStyleDeclaration>): void {
  if (target instanceof HTMLElement) {
    applyStyleMap(target, style);
    target.querySelectorAll<HTMLElement>("*").forEach((child) => {
      applyStyleMap(child, style);
    });
    return;
  }

  if (target instanceof DocumentFragment) {
    target.querySelectorAll<HTMLElement>("*").forEach((child) => {
      applyStyleMap(child, style);
    });
  }
}

function getClosestParagraph(node: Node | null): HTMLElement | null {
  if (!node) {
    return null;
  }
  if (node instanceof HTMLElement) {
    return node.closest("p");
  }
  return node.parentElement?.closest("p") ?? null;
}

function createParagraphAnchorSnapshot(
  editor: HTMLElement,
  range: Range
): ParagraphAnchorSnapshot | null {
  const paragraph = getClosestParagraph(range.startContainer);
  if (!paragraph || paragraph.parentElement !== editor) {
    return null;
  }

  const paragraphId = paragraph.dataset.nodeId;
  if (!paragraphId) {
    return null;
  }

  try {
    const collapsed = range.cloneRange();
    collapsed.collapse(true);
    const probe = document.createRange();
    probe.selectNodeContents(paragraph);
    probe.setEnd(collapsed.startContainer, collapsed.startOffset);
    const offset = Math.max(0, probe.toString().length);
    return { paragraphId, offset };
  } catch {
    const offset = Math.max(0, paragraph.textContent?.length ?? 0);
    return { paragraphId, offset };
  }
}

function resolveRangeFromAnchorSnapshot(
  editor: HTMLElement,
  snapshot: ParagraphAnchorSnapshot | null
): Range | null {
  if (!snapshot) {
    return null;
  }

  const paragraph = editor.querySelector(
    `p[data-node-id="${snapshot.paragraphId}"]`
  ) as HTMLElement | null;
  if (!paragraph) {
    return null;
  }

  let remaining = Math.max(0, snapshot.offset);
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  let lastTextNode: Text | null = null;

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    lastTextNode = textNode;
    const length = textNode.nodeValue?.length ?? 0;
    if (remaining <= length) {
      const range = document.createRange();
      range.setStart(textNode, remaining);
      range.collapse(true);
      return range;
    }
    remaining -= length;
  }

  const range = document.createRange();
  if (lastTextNode) {
    range.setStart(lastTextNode, lastTextNode.nodeValue?.length ?? 0);
  } else {
    range.setStart(paragraph, paragraph.childNodes.length);
  }
  range.collapse(true);
  return range;
}

function collectParagraphsInRange(editor: HTMLElement, range: Range): HTMLElement[] {
  const paragraphs = [...editor.querySelectorAll("p[data-node-type='paragraph'], p")] as HTMLElement[];
  return paragraphs.filter((paragraph) => {
    try {
      return range.intersectsNode(paragraph);
    } catch {
      return false;
    }
  });
}

function isRangeFullyBold(range: Range): boolean {
  if (range.collapsed) {
    return isNodeBold(range.startContainer);
  }

  const ancestor =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;

  if (!ancestor) {
    return isNodeBold(range.startContainer);
  }

  const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT);
  let seenTextNode = false;

  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    if (!textNode.nodeValue || textNode.nodeValue.trim().length === 0) {
      continue;
    }

    try {
      if (!range.intersectsNode(textNode)) {
        continue;
      }
    } catch {
      continue;
    }

    seenTextNode = true;
    if (!isNodeBold(textNode)) {
      return false;
    }
  }

  if (!seenTextNode) {
    return isNodeBold(range.startContainer);
  }

  return true;
}

function insertFigureBlock(editor: HTMLElement, figure: HTMLElement): void {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  const anchorElement =
    anchor instanceof HTMLElement ? anchor : anchor?.parentElement ?? null;

  const block = anchorElement?.closest("p,figure,ul,ol") as HTMLElement | null;
  if (block && block.parentElement === editor) {
    block.insertAdjacentElement("afterend", figure);
    placeCaretAfter(figure);
    return;
  }

  editor.appendChild(figure);
  placeCaretAfter(figure);
}

function insertFigureAtBookmark(
  editor: HTMLElement,
  marker: HTMLElement,
  figure: HTMLElement
): boolean {
  const paragraph = marker.closest("p") as HTMLElement | null;
  if (paragraph && paragraph.parentElement === editor) {
    const tailRange = document.createRange();
    tailRange.setStartAfter(marker);
    tailRange.setEnd(paragraph, paragraph.childNodes.length);
    const tailFragment = tailRange.extractContents();

    marker.remove();
    paragraph.insertAdjacentElement("afterend", figure);

    if (tailFragment.childNodes.length > 0) {
      const trailingParagraph = paragraph.cloneNode(false) as HTMLElement;
      trailingParagraph.dataset.nodeType = "paragraph";
      trailingParagraph.dataset.nodeId = createId("para");
      trailingParagraph.appendChild(tailFragment);
      figure.insertAdjacentElement("afterend", trailingParagraph);
    }

    placeCaretAfter(figure);
    return true;
  }

  const block = marker.closest("figure,ul,ol,div,p") as HTMLElement | null;
  if (block && block.parentElement === editor) {
    block.insertAdjacentElement("afterend", figure);
    marker.remove();
    placeCaretAfter(figure);
    return true;
  }

  if (marker.parentElement === editor) {
    marker.insertAdjacentElement("afterend", figure);
    marker.remove();
    placeCaretAfter(figure);
    return true;
  }

  if (marker.parentElement) {
    marker.parentElement.insertBefore(figure, marker.nextSibling);
    marker.remove();
    placeCaretAfter(figure);
    return true;
  }

  return false;
}

function insertFigureAtRange(editor: HTMLElement, range: Range, figure: HTMLElement): boolean {
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    return false;
  }

  const marker = document.createElement("span");
  marker.contentEditable = "false";
  marker.style.display = "inline-block";
  marker.style.width = "0";
  marker.style.height = "0";
  marker.style.overflow = "hidden";
  marker.style.lineHeight = "0";
  marker.style.pointerEvents = "none";

  const collapsed = range.cloneRange();
  collapsed.collapse(true);
  collapsed.insertNode(marker);

  const selection = window.getSelection();
  if (selection) {
    const after = document.createRange();
    after.setStartAfter(marker);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
  }

  return insertFigureAtBookmark(editor, marker, figure);
}

async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    const loaded = new Promise<{ width: number; height: number }>((resolve, reject) => {
      image.onload = () => {
        resolve({
          width: image.naturalWidth || 0,
          height: image.naturalHeight || 0
        });
      };
      image.onerror = () => reject(new Error("无法读取图片尺寸"));
    });
    image.src = objectUrl;
    return await loaded;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function isSupportedImageFile(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  if (isSupportedImageMimeType(type)) {
    return true;
  }

  const name = file.name.toLowerCase();
  return SUPPORTED_IMAGE_EXTENSIONS.some((ext) => name.endsWith(`.${ext}`));
}

export function RichEditor({
  projectId,
  doc,
  onDocChange,
  onCommandFeedback
}: RichEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastLocalUpdateRef = useRef(0);
  const lastRangeRef = useRef<Range | null>(null);
  const lastExpandedRangeRef = useRef<Range | null>(null);
  const lastParagraphIdRef = useRef<string | null>(null);
  const insertBookmarkIdRef = useRef<string | null>(null);
  const selectionAnchorRef = useRef<ParagraphAnchorSnapshot | null>(null);
  const selectionExpandedAnchorRef = useRef<ParagraphAnchorSnapshot | null>(null);
  const insertAnchorRef = useRef<ParagraphAnchorSnapshot | null>(null);
  const pendingInsertRef = useRef<PendingInsertContext | null>(null);

  const [command, setCommand] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [fontSize, setFontSize] = useState(36);
  const [lineHeight, setLineHeight] = useState(1.6);
  const [letterSpacing, setLetterSpacing] = useState(0);
  const [inlinePadding, setInlinePadding] = useState(0);
  const [inlineColor, setInlineColor] = useState(BODY_TEXT_COLOR);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedImagePercent, setSelectedImagePercent] = useState(100);

  useEffect(() => {
    const element = editorRef.current;
    if (!element) {
      return;
    }

    if (doc.updatedAt === lastLocalUpdateRef.current) {
      return;
    }

    element.innerHTML = richDocToEditorHtml(doc);
  }, [doc]);

  const emitDoc = useCallback(() => {
    const element = editorRef.current;
    if (!element) {
      return;
    }

    const nextDoc = editorElementToRichDoc(element, doc);
    lastLocalUpdateRef.current = nextDoc.updatedAt;
    onDocChange(nextDoc);
  }, [doc, onDocChange]);

  const syncSelectionStyles = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
      return;
    }

    const anchorNode = selection.focusNode || range.startContainer;
    const anchorElement = anchorNode instanceof HTMLElement ? anchorNode : anchorNode.parentElement;
    if (!anchorElement) {
      return;
    }

    const probe = (anchorElement.closest("span,p") as HTMLElement | null) ?? anchorElement;
    const computed = window.getComputedStyle(probe);
    const computedFontSize = parseFloat(computed.fontSize);
    const nextFontSize = Number.isFinite(computedFontSize) ? Math.round(computedFontSize) : 36;
    setFontSize(Math.max(10, Math.min(70, nextFontSize)));

    const lineHeightRaw = computed.lineHeight;
    const lineHeightPx =
      lineHeightRaw === "normal"
        ? Number.NaN
        : Number.parseFloat(lineHeightRaw.replace("px", "").trim());
    const nextLineHeight = Number.isFinite(lineHeightPx) && computedFontSize > 0
      ? Number((lineHeightPx / computedFontSize).toFixed(2))
      : 1.6;
    setLineHeight(Math.max(1, Math.min(2.4, nextLineHeight)));

    const letterSpacingRaw = computed.letterSpacing;
    const nextLetterSpacing =
      letterSpacingRaw === "normal"
        ? 0
        : Number.parseFloat(letterSpacingRaw.replace("px", "").trim());
    setLetterSpacing(
      Number.isFinite(nextLetterSpacing) ? Math.max(-2, Math.min(12, nextLetterSpacing)) : 0
    );

    const leftPad = Number.parseFloat(computed.paddingLeft.replace("px", "").trim());
    const rightPad = Number.parseFloat(computed.paddingRight.replace("px", "").trim());
    const nextPadding = Number.isFinite(leftPad) || Number.isFinite(rightPad)
      ? Math.max(Number.isFinite(leftPad) ? leftPad : 0, Number.isFinite(rightPad) ? rightPad : 0)
      : 0;
    setInlinePadding(Math.max(0, Math.min(80, Math.round(nextPadding))));
    setInlineColor(normalizeHexColor(computed.color || BODY_TEXT_COLOR, BODY_TEXT_COLOR));
  }, []);

  const rememberSelection = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (editor.contains(range.startContainer) && editor.contains(range.endContainer)) {
      lastRangeRef.current = range.cloneRange();
      const paragraph = getClosestParagraph(range.startContainer);
      lastParagraphIdRef.current = paragraph?.dataset.nodeId || null;
      const snapshot = createParagraphAnchorSnapshot(editor, range);
      selectionAnchorRef.current = snapshot;
      if (!range.collapsed) {
        lastExpandedRangeRef.current = range.cloneRange();
        selectionExpandedAnchorRef.current = snapshot;
      }
    }
  }, []);

  const restoreSelectionFromSnapshot = useCallback(
    (snapshot: ParagraphAnchorSnapshot | null) => {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection) {
        return false;
      }

      const range = resolveRangeFromAnchorSnapshot(editor, snapshot);
      if (!range) {
        return false;
      }

      selection.removeAllRanges();
      selection.addRange(range);
      lastRangeRef.current = range.cloneRange();
      lastParagraphIdRef.current = snapshot?.paragraphId || null;
      return true;
    },
    []
  );

  const restoreSelection = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const range = lastRangeRef.current;

    if (!editor || !selection || !range) {
      return false;
    }
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
      return false;
    }

    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }, []);

  const clearInsertBookmarks = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      insertBookmarkIdRef.current = null;
      insertAnchorRef.current = null;
      pendingInsertRef.current = null;
      return;
    }
    editor.querySelectorAll("[data-insert-bookmark]").forEach((node) => node.remove());
    insertBookmarkIdRef.current = null;
    insertAnchorRef.current = null;
    pendingInsertRef.current = null;
  }, []);

  const placeInsertBookmark = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
      return false;
    }

    const current = selection.getRangeAt(0);
    if (!editor.contains(current.startContainer) || !editor.contains(current.endContainer)) {
      return false;
    }
    const anchorSnapshot = createParagraphAnchorSnapshot(editor, current);
    insertAnchorRef.current = anchorSnapshot;

    clearInsertBookmarks();

    const bookmark = document.createElement("span");
    const bookmarkId = createId("bookmark");
    bookmark.dataset.insertBookmark = bookmarkId;
    bookmark.contentEditable = "false";
    bookmark.style.display = "inline-block";
    bookmark.style.width = "0";
    bookmark.style.height = "0";
    bookmark.style.overflow = "hidden";
    bookmark.style.lineHeight = "0";
    bookmark.style.pointerEvents = "none";

    const range = current.cloneRange();
    range.collapse(false);
    range.insertNode(bookmark);

    const after = document.createRange();
    after.setStartAfter(bookmark);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);

    lastRangeRef.current = after.cloneRange();
    const paragraph = getClosestParagraph(after.startContainer);
    lastParagraphIdRef.current = paragraph?.dataset.nodeId || null;
    insertBookmarkIdRef.current = bookmarkId;
    pendingInsertRef.current = {
      anchor: anchorSnapshot,
      paragraphId: paragraph?.dataset.nodeId || null,
      bookmarkId,
      createdAt: Date.now()
    };
    return true;
  }, [clearInsertBookmarks]);

  useEffect(() => {
    const onSelectionChange = () => {
      rememberSelection();
      syncSelectionStyles();
    };

    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [rememberSelection, syncSelectionStyles]);

  const clearActiveSelectionMarkers = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.querySelectorAll("[data-active-selection]").forEach((el) => {
      el.removeAttribute("data-active-selection");
    });
  }, []);

  const lockSelectionAsSpan = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      rememberSelection();
      return;
    }
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
      rememberSelection();
      return;
    }

    // Already inside an active-selection span – just remember selection
    let node: Node | null = range.startContainer;
    while (node && node !== editor) {
      if (
        node instanceof HTMLElement &&
        node.hasAttribute("data-active-selection") &&
        node.tagName === "SPAN" &&
        node.contains(range.endContainer)
      ) {
        rememberSelection();
        return;
      }
      node = node.parentElement;
    }

    // Clear any existing markers
    clearActiveSelectionMarkers();

    // Create wrapper span with persistent highlight
    const span = document.createElement("span");
    span.setAttribute("data-active-selection", "true");

    try {
      const fragment = range.extractContents();
      span.appendChild(fragment);
      range.insertNode(span);

      // Select the span contents
      const nextRange = document.createRange();
      nextRange.selectNodeContents(span);
      selection.removeAllRanges();
      selection.addRange(nextRange);

      lastRangeRef.current = nextRange.cloneRange();
      lastExpandedRangeRef.current = nextRange.cloneRange();
      lastParagraphIdRef.current =
        getClosestParagraph(nextRange.startContainer)?.dataset.nodeId || null;
      const nextSnapshot = createParagraphAnchorSnapshot(editor, nextRange);
      selectionAnchorRef.current = nextSnapshot;
      selectionExpandedAnchorRef.current = nextSnapshot;

      emitDoc();
    } catch {
      rememberSelection();
    }
  }, [clearActiveSelectionMarkers, emitDoc, rememberSelection]);

  const findActiveSelectionSpan = useCallback((range: Range): HTMLElement | null => {
    const editor = editorRef.current;
    if (!editor) return null;
    let node: Node | null = range.startContainer;
    while (node && node !== editor) {
      if (
        node instanceof HTMLElement &&
        node.hasAttribute("data-active-selection") &&
        node.tagName === "SPAN" &&
        node.contains(range.endContainer)
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }, []);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const editor = editorRef.current;
      if (!editor) return;
      const panel = editor.closest(".panel");

      if (target.closest(".toolbar") || target.closest(".style-slider-grid")) {
        return;
      }

      if (target.closest(".editor-canvas")) {
        clearActiveSelectionMarkers();
        lastExpandedRangeRef.current = null;
        selectionExpandedAnchorRef.current = null;
        return;
      }

      if (!panel || !panel.contains(target)) {
        clearActiveSelectionMarkers();
        lastExpandedRangeRef.current = null;
        selectionExpandedAnchorRef.current = null;
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [clearActiveSelectionMarkers]);

  const applyImageResize = useCallback(
    (percent: number) => {
      if (!selectedImageId) {
        return;
      }

      const editor = editorRef.current;
      if (!editor) {
        return;
      }

      const figure = editor.querySelector(
        `figure[data-node-id="${selectedImageId}"]`
      ) as HTMLElement | null;
      if (!figure) {
        return;
      }

      const img = figure.querySelector("img") as HTMLImageElement | null;
      if (!img) {
        return;
      }

      const originalWidth = Number(figure.dataset.originalWidth || figure.dataset.renderWidth || 640);
      const originalHeight = Number(figure.dataset.originalHeight || figure.dataset.renderHeight || 640);

      const nextPercent = Math.max(20, Math.min(100, percent));
      const nextWidth = Math.max(40, Math.round((originalWidth * nextPercent) / 100));
      const nextHeight = Math.max(40, Math.round((originalHeight * nextPercent) / 100));

      figure.dataset.renderPercent = String(nextPercent);
      figure.dataset.renderWidth = String(nextWidth);
      figure.dataset.renderHeight = String(nextHeight);

      img.style.width = `${nextWidth}px`;
      img.style.height = `${nextHeight}px`;

      setSelectedImagePercent(nextPercent);
      emitDoc();
    },
    [emitDoc, selectedImageId]
  );

  const insertImage = useCallback(
    async (file: File) => {
      if (!projectId) {
        return;
      }

      setIsUploading(true);
      setUploadMessage("");
      const insertContext: PendingInsertContext = pendingInsertRef.current
        ? {
            ...pendingInsertRef.current
          }
        : {
            anchor: insertAnchorRef.current ?? selectionAnchorRef.current,
            paragraphId: lastParagraphIdRef.current,
            bookmarkId: insertBookmarkIdRef.current,
            createdAt: Date.now()
          };
      try {
        const dimensions = await readImageDimensions(file).catch(() => ({
          width: 0,
          height: 0
        }));

        const form = new FormData();
        form.append("projectId", projectId);
        form.append("file", file);
        form.append("width", String(dimensions.width || 0));
        form.append("height", String(dimensions.height || 0));

        const response = await fetch("/api/assets/upload", {
          method: "POST",
          body: form
        });

        const payload = (await response.json()) as {
          assetId: string;
          url: string;
          size: { width: number; height: number };
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "图片上传失败");
        }

        const editor = editorRef.current;
        if (!editor) {
          return;
        }

        const maxWidth = Math.max(220, editor.clientWidth - 80);
        const initialWidth = Math.min(payload.size.width, maxWidth);
        const initialHeight = Math.max(
          40,
          Math.round((payload.size.height / Math.max(1, payload.size.width)) * initialWidth)
        );
        const percent = Math.max(20, Math.min(100, Math.round((initialWidth / payload.size.width) * 100)));

        const figure = document.createElement("figure");
        figure.dataset.nodeType = "image";
        figure.dataset.nodeId = `img_${Date.now()}`;
        figure.dataset.assetId = payload.assetId;
        figure.dataset.originalWidth = String(payload.size.width);
        figure.dataset.originalHeight = String(payload.size.height);
        figure.dataset.renderWidth = String(initialWidth);
        figure.dataset.renderHeight = String(initialHeight);
        figure.dataset.renderPercent = String(percent);
        figure.dataset.align = "center";
        figure.contentEditable = "false";
        figure.style.display = "flex";
        figure.style.justifyContent = "center";
        figure.style.margin = "10px 0 18px";

        const image = document.createElement("img");
        image.src = payload.url;
        image.setAttribute("data-asset-id", payload.assetId);
        image.alt = "";
        image.style.width = `${initialWidth}px`;
        image.style.height = `${initialHeight}px`;
        image.style.maxWidth = "100%";
        image.style.objectFit = "contain";
        image.style.borderRadius = "12px";
        image.style.display = "block";

        figure.appendChild(image);

        let inserted = false;

        // Highest priority: exact bookmark captured before opening file dialog.
        const bookmarkId = insertContext.bookmarkId;
        if (bookmarkId) {
          const marker = editor.querySelector(
            `[data-insert-bookmark="${bookmarkId}"]`
          ) as HTMLElement | null;
          if (marker) {
            inserted = insertFigureAtBookmark(editor, marker, figure);
          }
        }
        insertBookmarkIdRef.current = null;

        if (!inserted) {
          // Fallback: restore selection from range/snapshot and insert at that exact point.
          const restored =
            restoreSelection() ||
            restoreSelectionFromSnapshot(insertContext.anchor) ||
            restoreSelectionFromSnapshot(selectionAnchorRef.current);
          if (restored) {
            const selection = window.getSelection();
            const range =
              selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
            if (range) {
              inserted = insertFigureAtRange(editor, range, figure);
            }
          }
        }

        if (!inserted && insertContext.paragraphId) {
          // Fallback: insert after the last known paragraph.
          const paragraph = editor.querySelector(
            `p[data-node-id="${insertContext.paragraphId}"]`
          ) as HTMLElement | null;
          if (paragraph && paragraph.parentElement === editor) {
            paragraph.insertAdjacentElement("afterend", figure);
            placeCaretAfter(figure);
            inserted = true;
          }
        }

        if (!inserted) {
          insertFigureBlock(editor, figure);
        }

        setSelectedImageId(figure.dataset.nodeId || null);
        setSelectedImagePercent(percent);
        emitDoc();
        rememberSelection();

        onCommandFeedback("图片已插入，可用下方滑杆调整尺寸。");
        setUploadMessage("图片上传成功，可在下方调节尺寸。");
      } catch (error) {
        const message = error instanceof Error ? error.message : "图片上传失败";
        onCommandFeedback(message);
        setUploadMessage(message);
      } finally {
        clearInsertBookmarks();
        setIsUploading(false);
      }
    },
    [
      clearInsertBookmarks,
      emitDoc,
      onCommandFeedback,
      projectId,
      rememberSelection,
      restoreSelection,
      restoreSelectionFromSnapshot
    ]
  );

  const handlePaste = useCallback(
    async (event: ClipboardEvent<HTMLDivElement>) => {
      const imageItem = [...event.clipboardData.items].find((item) =>
        item.type.startsWith("image/")
      );

      if (!imageItem) {
        return;
      }

      const file = imageItem.getAsFile();
      if (!file) {
        return;
      }

      event.preventDefault();
      await insertImage(file);
    },
    [insertImage]
  );

  const runCommand = useCallback(async () => {
    if (!command.trim()) {
      return;
    }

    const response = await fetch("/api/editor/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, doc })
    });

    const payload = (await response.json()) as {
      error?: string;
      result?: { confidence: number; operations: unknown[] };
      patchedDoc?: RichDoc;
    };

    if (!response.ok || !payload.patchedDoc) {
      onCommandFeedback(payload.error || "命令解析失败");
      return;
    }

    onDocChange(payload.patchedDoc);
    setCommand("");

    if (!payload.result?.operations.length) {
      onCommandFeedback("未识别到可执行命令，请换种说法。");
      return;
    }

    onCommandFeedback(`命令已执行（置信度 ${Math.round((payload.result.confidence ?? 0) * 100)}%）。`);
  }, [command, doc, onCommandFeedback, onDocChange]);

  const resolveWorkingRange = useCallback((preferExpanded = false): Range | null => {
    const editor = editorRef.current;
    if (!editor) {
      return null;
    }

    if (preferExpanded) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const current = selection.getRangeAt(0);
        if (
          !current.collapsed &&
          editor.contains(current.startContainer) &&
          editor.contains(current.endContainer)
        ) {
          return current.cloneRange();
        }
      }

      const expanded = lastExpandedRangeRef.current;
      if (
        expanded &&
        !expanded.collapsed &&
        editor.contains(expanded.startContainer) &&
        editor.contains(expanded.endContainer)
      ) {
        return expanded.cloneRange();
      }

      const expandedBySnapshot = resolveRangeFromAnchorSnapshot(editor, selectionExpandedAnchorRef.current);
      if (expandedBySnapshot) {
        return expandedBySnapshot;
      }
    }

    const saved = lastRangeRef.current;
    if (saved && editor.contains(saved.startContainer) && editor.contains(saved.endContainer)) {
      return saved.cloneRange();
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const current = selection.getRangeAt(0);
    if (!editor.contains(current.startContainer) || !editor.contains(current.endContainer)) {
      return resolveRangeFromAnchorSnapshot(editor, selectionAnchorRef.current);
    }

    return current.cloneRange();
  }, []);

  const applySelectionStyle = useCallback(
    (
      style: Partial<CSSStyleDeclaration>,
      options?: {
        forceParagraph?: boolean;
      }
    ) => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }

      const workingRange = resolveWorkingRange(true);
      let ok = false;

      if (workingRange) {
        const startParagraph = getClosestParagraph(workingRange.startContainer);
        const endParagraph = getClosestParagraph(workingRange.endContainer);
        const isCrossParagraph = Boolean(
          startParagraph && endParagraph && startParagraph !== endParagraph
        );

        if (workingRange.collapsed || options?.forceParagraph || isCrossParagraph) {
          const hitParagraphs = collectParagraphsInRange(editor, workingRange);
          if (hitParagraphs.length > 0) {
            hitParagraphs.forEach((paragraph) => {
              applyStyleDeep(paragraph, style);
              paragraph.setAttribute("data-active-selection", "true");
            });
            ok = true;
          } else {
            const fallbackParagraph = startParagraph;
            if (fallbackParagraph) {
              applyStyleDeep(fallbackParagraph, style);
              fallbackParagraph.setAttribute("data-active-selection", "true");
              ok = true;
            }
          }

          if (ok) {
            const selection = window.getSelection();
            if (selection) {
              selection.removeAllRanges();
              selection.addRange(workingRange);
            }
            const next = workingRange.cloneRange();
            lastRangeRef.current = next;
            lastExpandedRangeRef.current = next.cloneRange();
            const nextSnapshot = createParagraphAnchorSnapshot(editor, next);
            selectionAnchorRef.current = nextSnapshot;
            selectionExpandedAnchorRef.current = nextSnapshot;
            lastParagraphIdRef.current = getClosestParagraph(next.startContainer)?.dataset.nodeId || null;
          }
        } else {
          const existingSpan = findActiveSelectionSpan(workingRange);

          if (existingSpan) {
            applyStyleDeep(existingSpan, style);

            const nextRange = document.createRange();
            nextRange.selectNodeContents(existingSpan);
            const selection = window.getSelection();
            if (selection) {
              selection.removeAllRanges();
              selection.addRange(nextRange);
            }
            lastRangeRef.current = nextRange.cloneRange();
            lastExpandedRangeRef.current = nextRange.cloneRange();
            lastParagraphIdRef.current = getClosestParagraph(nextRange.startContainer)?.dataset.nodeId || null;
            const nextSnapshot = createParagraphAnchorSnapshot(editor, nextRange);
            selectionAnchorRef.current = nextSnapshot;
            selectionExpandedAnchorRef.current = nextSnapshot;
            ok = true;
          } else {
            const span = document.createElement("span");
            span.setAttribute("data-active-selection", "true");
            applyStyleDeep(span, style);

            try {
              const fragment = workingRange.extractContents();
              span.appendChild(fragment);
              applyStyleDeep(span, style);
              workingRange.insertNode(span);

              const nextRange = document.createRange();
              nextRange.selectNodeContents(span);
              const selection = window.getSelection();
              if (selection) {
                selection.removeAllRanges();
                selection.addRange(nextRange);
              }
              lastRangeRef.current = nextRange.cloneRange();
              lastExpandedRangeRef.current = nextRange.cloneRange();
              lastParagraphIdRef.current = getClosestParagraph(nextRange.startContainer)?.dataset.nodeId || null;
              const nextSnapshot = createParagraphAnchorSnapshot(editor, nextRange);
              selectionAnchorRef.current = nextSnapshot;
              selectionExpandedAnchorRef.current = nextSnapshot;
              ok = true;
            } catch {
              ok = false;
            }
          }
        }
      }

      if (!ok && lastParagraphIdRef.current) {
        const paragraph = editor.querySelector(
          `p[data-node-id="${lastParagraphIdRef.current}"]`
        ) as HTMLElement | null;
        if (paragraph) {
          applyStyleMap(paragraph, style);
          ok = true;
        }
      }

      if (ok) {
        emitDoc();
        syncSelectionStyles();
      }
      rememberSelection();
    },
    [emitDoc, findActiveSelectionSpan, rememberSelection, resolveWorkingRange, syncSelectionStyles]
  );

  const applyColor = useCallback(
    (color: string) => {
      const normalized = normalizeHexColor(color, BODY_TEXT_COLOR);
      setInlineColor(normalized);

      applySelectionStyle({ color: normalized });
    },
    [applySelectionStyle]
  );

  const updateFontSize = useCallback(
    (value: number) => {
      const next = Math.max(10, Math.min(70, Math.round(value)));
      setFontSize(next);
      applySelectionStyle({ fontSize: `${next}px` });
    },
    [applySelectionStyle]
  );

  const updateLineHeight = useCallback(
    (value: number) => {
      const next = Math.max(1, Math.min(2.4, Number(value.toFixed(2))));
      setLineHeight(next);
      applySelectionStyle({ lineHeight: String(next) });
    },
    [applySelectionStyle]
  );

  const updateLetterSpacing = useCallback(
    (value: number) => {
      const next = Math.max(-2, Math.min(12, Number(value.toFixed(1))));
      setLetterSpacing(next);
      applySelectionStyle({ letterSpacing: `${next}px` });
    },
    [applySelectionStyle]
  );

  const updateInlinePadding = useCallback(
    (value: number) => {
      const next = Math.max(0, Math.min(80, Math.round(value)));
      setInlinePadding(next);
      applySelectionStyle(
        {
          paddingLeft: `${next}px`,
          paddingRight: `${next}px`
        }
      );
    },
    [applySelectionStyle]
  );

  const imageResizeLabel = useMemo(() => `${selectedImagePercent}%`, [selectedImagePercent]);

  return (
    <div className="panel">
      <div className="panel-header">
        <strong>文本编辑区</strong>
        <span>{isUploading ? "上传中..." : "支持图片/emoji/富文本"}</span>
      </div>

      {uploadMessage ? (
        <div className="toolbar" style={{ color: uploadMessage.includes("成功") ? "#047857" : "#b91c1c" }}>
          {uploadMessage}
        </div>
      ) : null}

      <div className="toolbar">
        <button
          type="button"
          onMouseDown={() => {
            lockSelectionAsSpan();
          }}
          onClick={() => {
            const workingRange = resolveWorkingRange();
            const shouldUnbold = workingRange ? isRangeFullyBold(workingRange) : false;
            applySelectionStyle({ fontWeight: shouldUnbold ? "400" : "700" });
          }}
        >
          加粗
        </button>

        <div className="color-swatch-group" role="group" aria-label="常用文字颜色">
          {COMMON_TEXT_COLORS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`color-swatch-btn ${inlineColor === item.value ? "is-active" : ""}`}
              onMouseDown={() => {
                lockSelectionAsSpan();
              }}
              onClick={() => {
                applyColor(item.value);
              }}
              title={item.label}
            >
              <span className="color-swatch-dot" style={{ backgroundColor: item.value }} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onMouseDown={() => {
            rememberSelection();
          }}
          onClick={() => {
            restoreSelection();
            runExecCommand("insertLineBreak");
            emitDoc();
            rememberSelection();
          }}
        >
          换行
        </button>

        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            rememberSelection();
            placeInsertBookmark();
          }}
          onClick={() => {
            fileInputRef.current?.click();
          }}
        >
          插入图片
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
          style={{ display: "none" }}
          onChange={async (event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            if (!file) {
              clearInsertBookmarks();
              return;
            }
            if (!isSupportedImageFile(file)) {
              setUploadMessage("仅支持 PNG/JPG/WebP/GIF/HEIC 图片。");
              input.value = "";
              clearInsertBookmarks();
              return;
            }
            await insertImage(file);
            input.value = "";
          }}
        />
      </div>

      <div className="toolbar style-slider-grid">
        <label className="style-slider">
          <span>字体大小</span>
          <strong>{fontSize}px</strong>
          <input
            type="range"
            min={10}
            max={70}
            step={1}
            value={fontSize}
            onMouseDown={() => {
              lockSelectionAsSpan();
            }}
            onInput={(event) => {
              updateFontSize(Number((event.target as HTMLInputElement).value));
            }}
            onChange={(event) => {
              updateFontSize(Number((event.target as HTMLInputElement).value));
            }}
          />
        </label>

        <label className="style-slider">
          <span>行高</span>
          <strong>{lineHeight.toFixed(2)}</strong>
          <input
            type="range"
            min={1}
            max={2.4}
            step={0.05}
            value={lineHeight}
            onMouseDown={() => {
              lockSelectionAsSpan();
            }}
            onInput={(event) => {
              updateLineHeight(Number((event.target as HTMLInputElement).value));
            }}
            onChange={(event) => {
              updateLineHeight(Number((event.target as HTMLInputElement).value));
            }}
          />
        </label>

        <label className="style-slider">
          <span>字间距</span>
          <strong>{letterSpacing.toFixed(1)}px</strong>
          <input
            type="range"
            min={-2}
            max={12}
            step={0.5}
            value={letterSpacing}
            onMouseDown={() => {
              lockSelectionAsSpan();
            }}
            onInput={(event) => {
              updateLetterSpacing(Number((event.target as HTMLInputElement).value));
            }}
            onChange={(event) => {
              updateLetterSpacing(Number((event.target as HTMLInputElement).value));
            }}
          />
        </label>

        <label className="style-slider">
          <span>内边距</span>
          <strong>{inlinePadding}px</strong>
          <input
            type="range"
            min={0}
            max={80}
            step={1}
            value={inlinePadding}
            onMouseDown={() => {
              lockSelectionAsSpan();
            }}
            onInput={(event) => {
              updateInlinePadding(Number((event.target as HTMLInputElement).value));
            }}
            onChange={(event) => {
              updateInlinePadding(Number((event.target as HTMLInputElement).value));
            }}
          />
        </label>
      </div>

      {selectedImageId ? (
        <div className="toolbar">
          <span>图片尺寸</span>
          <input
            type="range"
            min={20}
            max={100}
            step={1}
            value={selectedImagePercent}
            onChange={(event) => {
              applyImageResize(Number(event.target.value));
            }}
          />
          <span>{imageResizeLabel}</span>
          <button
            type="button"
            onClick={() => {
              const editor = editorRef.current;
              if (!editor || !selectedImageId) {
                return;
              }

              const target = editor.querySelector(
                `figure[data-node-id="${selectedImageId}"]`
              );
              if (target) {
                target.remove();
                setSelectedImageId(null);
                emitDoc();
              }
            }}
          >
            删除图片
          </button>
        </div>
      ) : null}

      <div className="toolbar">
        <input
          type="text"
          placeholder="自然语言命令，例如：把第2段改成16号蓝色并加空一行"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          style={{ flex: 1, minWidth: 220 }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void runCommand();
            }
          }}
        />
        <button type="button" onClick={() => void runCommand()}>
          执行命令
        </button>
      </div>

      <div className="editor-root">
        <div
          ref={editorRef}
          className="editor-canvas"
          contentEditable
          suppressContentEditableWarning
          onInput={emitDoc}
          onClick={(event) => {
            const target = event.target as HTMLElement;
            const figure = target.closest("figure[data-node-type='image']") as HTMLElement | null;

            if (!figure) {
              setSelectedImageId(null);
              return;
            }

            const nodeId = figure.dataset.nodeId || null;
            const percent = Number(figure.dataset.renderPercent || "100");
            setSelectedImageId(nodeId);
            setSelectedImagePercent(Number.isFinite(percent) ? percent : 100);
          }}
          onPaste={(event) => {
            void handlePaste(event);
          }}
          onDragOver={(event) => {
            event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            const files = [...event.dataTransfer.files];
            const imageFile = files.find((file) => isSupportedImageFile(file));

            if (imageFile) {
              void insertImage(imageFile);
            }
          }}
          onKeyDown={(event) => {
            if (event.metaKey && event.shiftKey && event.key === "7") {
              event.preventDefault();
              document.execCommand("insertUnorderedList");
              emitDoc();
            }
          }}
          onBlur={emitDoc}
        />
      </div>
    </div>
  );
}
