"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import type { PageRender, Template, TextRun, ThemeVars } from "@/lib/types";

interface PagePreviewProps {
  projectId: string;
  template: Template;
  theme: ThemeVars;
  pages: PageRender[];
  compact?: boolean;
  selectedPageNo?: number;
  onSelectPage?: (pageNo: number) => void;
}

function runStyle(theme: ThemeVars, run: TextRun): CSSProperties {
  const paddingInline = run.marks?.paddingInline ?? 0;
  return {
    whiteSpace: "pre",
    fontWeight: run.marks?.bold ? 700 : 400,
    color: run.marks?.color || theme.textColor,
    fontSize: `${run.marks?.fontSize || theme.bodyFontSize}px`,
    lineHeight: run.marks?.lineHeight ? String(run.marks.lineHeight) : undefined,
    letterSpacing:
      run.marks?.letterSpacing || run.marks?.letterSpacing === 0
        ? `${run.marks.letterSpacing}px`
        : undefined,
    paddingLeft: paddingInline ? `${paddingInline}px` : undefined,
    paddingRight: paddingInline ? `${paddingInline}px` : undefined,
    display: paddingInline ? "inline-block" : undefined
  };
}

function useScale(widthRef: RefObject<HTMLDivElement | null>, template: Template): number {
  const [width, setWidth] = useState(360);

  useEffect(() => {
    const element = widthRef.current;
    if (!element) {
      return;
    }

    const update = () => {
      setWidth(element.clientWidth);
    };

    update();

    const observer = new ResizeObserver(() => {
      update();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [widthRef]);

  return useMemo(() => {
    if (!template.canvasWidth) {
      return 1;
    }
    return Math.max(0.1, Math.min(1, width / template.canvasWidth));
  }, [template.canvasWidth, width]);
}

function extractAssetIdFromSrc(src: string): string {
  if (!src) {
    return "";
  }
  try {
    const pathname =
      src.startsWith("http://") || src.startsWith("https://")
        ? new URL(src).pathname
        : src;
    const match = pathname.match(/\/api\/assets\/([^/?#]+)/);
    return match?.[1] || "";
  } catch {
    const match = src.match(/\/api\/assets\/([^/?#]+)/);
    return match?.[1] || "";
  }
}

function resolveAssetSrc(src: string, assetId: string): string {
  const safeAssetId = (assetId || "").trim();
  const safeSrc = (src || "").trim();

  if (!safeSrc) {
    return safeAssetId ? `/api/assets/${safeAssetId}` : "";
  }

  try {
    if (safeSrc.startsWith("http://") || safeSrc.startsWith("https://")) {
      const parsed = new URL(safeSrc);
      if (parsed.pathname.startsWith("/api/assets/")) {
        return parsed.pathname;
      }
      return safeSrc;
    }
  } catch {
    // Fall through to string-based normalization.
  }

  if (safeSrc.startsWith("/api/assets/")) {
    return safeSrc.split("?")[0];
  }

  if ((safeSrc.startsWith("blob:") || safeSrc.startsWith("data:")) && safeAssetId) {
    return `/api/assets/${safeAssetId}`;
  }

  return safeSrc;
}

function PreviewImage(props: {
  src: string;
  assetId: string;
  width: number;
  height: number;
}) {
  const { src, assetId, width, height } = props;
  const normalizedAssetId = assetId || extractAssetIdFromSrc(src);
  const [effectiveSrc, setEffectiveSrc] = useState(() =>
    resolveAssetSrc(src, normalizedAssetId)
  );
  const retriedRef = useRef(false);

  useEffect(() => {
    retriedRef.current = false;
    setEffectiveSrc(resolveAssetSrc(src, normalizedAssetId));
  }, [src, normalizedAssetId]);

  const retryWithAssetId = () => {
    if (!normalizedAssetId || retriedRef.current) {
      return;
    }
    retriedRef.current = true;
    setEffectiveSrc(`/api/assets/${normalizedAssetId}?v=${Date.now()}`);
  };

  return (
    <img
      src={effectiveSrc}
      alt=""
      loading="eager"
      onLoad={(event) => {
        if (event.currentTarget.naturalWidth <= 2 || event.currentTarget.naturalHeight <= 2) {
          retryWithAssetId();
        }
      }}
      onError={() => {
        retryWithAssetId();
      }}
      style={{
        width,
        height,
        objectFit: "contain",
        borderRadius: 10,
        display: "block"
      }}
    />
  );
}

function PreviewCanvas(props: {
  page: PageRender;
  scale: number;
  template: Template;
  theme: ThemeVars;
  mini?: boolean;
}) {
  const { page, scale, template, theme, mini } = props;

  return (
    <div
      className="xhs-preview-page"
      style={{
        height: `${template.canvasHeight * scale}px`
      }}
    >
      <div
        style={{
          width: `${template.canvasWidth}px`,
          height: `${template.canvasHeight}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          background: theme.pageBackground,
          color: theme.textColor,
          fontFamily: theme.fontFamily,
          position: "absolute",
          left: 0,
          top: 0,
          borderRadius: mini ? 14 : 20,
          overflow: "hidden",
          border: mini ? "1px solid rgba(15,23,42,0.08)" : undefined
        }}
      >
        <div
          className="xhs-preview-content"
          style={{
            paddingTop: theme.pagePaddingTop,
            paddingRight: theme.pagePaddingRight,
            paddingBottom: theme.pagePaddingBottom,
            paddingLeft: theme.pagePaddingLeft,
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            overflow: "hidden",
            boxSizing: "border-box"
          }}
        >
          {page.items.map((item) => {
            if (item.type === "spacer") {
              return <div key={item.id} style={{ height: item.height }} />;
            }

            if (item.type === "image") {
              const justifyContent =
                item.align === "left"
                  ? "flex-start"
                  : item.align === "right"
                    ? "flex-end"
                    : "center";

              return (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    justifyContent,
                    width: "100%"
                  }}
                >
                  <PreviewImage
                    src={item.src}
                    assetId={item.assetId}
                    width={item.width}
                    height={item.height}
                  />
                </div>
              );
            }

            return (
              <div
                key={item.id}
                style={{
                  minHeight: item.lineHeight,
                  lineHeight: `${item.lineHeight}px`,
                  fontSize: `${theme.bodyFontSize}px`,
                  whiteSpace: "pre",
                  overflow: "hidden"
                }}
              >
                {item.runs.map((run, index) => (
                  <span key={`${item.id}-${index}`} style={runStyle(theme, run)}>
                    {run.text}
                  </span>
                ))}
              </div>
            );
          })}
        </div>

        <div
          style={{
            position: "absolute",
            right: theme.pagePaddingRight,
            bottom: 28,
            color: theme.secondaryColor,
            fontSize: 24
          }}
        >
          {theme.footerSignature}
        </div>
      </div>
    </div>
  );
}

export function PagePreview({
  projectId,
  template,
  theme,
  pages,
  compact,
  selectedPageNo,
  onSelectPage
}: PagePreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scale = useScale(containerRef, template);

  if (!pages.length) {
    return (
      <div className="panel">
        <div className="panel-header">
          <strong>分页预览</strong>
        </div>
        <div className="preview-list">暂无内容</div>
      </div>
    );
  }

  const selected =
    pages.find((item) => item.pageNo === selectedPageNo) ??
    pages[0];

  if (compact) {
    const selectedIndex = pages.findIndex((item) => item.pageNo === selected.pageNo);
    const previousPage = selectedIndex > 0 ? pages[selectedIndex - 1] : null;
    const nextPage = selectedIndex >= 0 && selectedIndex < pages.length - 1 ? pages[selectedIndex + 1] : null;

    return (
      <div className="panel preview-compact">
        <div className="panel-header">
          <strong>预览</strong>
          <button
            type="button"
            onClick={() => {
              window.open(
                `/api/export/page/${projectId}/${selected.pageNo}`,
                "_blank",
                "noopener,noreferrer"
              );
            }}
          >
            下载当前页
          </button>
        </div>

        <div className="preview-main" ref={containerRef}>
          <PreviewCanvas
            page={selected}
            scale={scale}
            template={template}
            theme={theme}
          />
        </div>

        <div className="preview-pager">
          <button
            type="button"
            disabled={!previousPage}
            onClick={() => {
              if (previousPage) {
                onSelectPage?.(previousPage.pageNo);
              }
            }}
          >
            上一页
          </button>
          <span>
            第 {selected.pageNo} / {pages.length} 页
          </span>
          <button
            type="button"
            disabled={!nextPage}
            onClick={() => {
              if (nextPage) {
                onSelectPage?.(nextPage.pageNo);
              }
            }}
          >
            下一页
          </button>
        </div>

        <div className="preview-mini-strip">
          {pages.map((page) => (
            <button
              key={page.pageNo}
              type="button"
              className={`preview-mini-item ${selected.pageNo === page.pageNo ? "is-active" : ""}`}
              onClick={() => {
                onSelectPage?.(page.pageNo);
              }}
            >
              {page.pageNo}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <strong>分页预览</strong>
        <span>{pages.length} 页</span>
      </div>
      <div className="preview-list" ref={containerRef}>
        {pages.map((page) => (
          <div key={page.pageNo} className="preview-card">
            <div className="preview-head">
              <strong>第 {page.pageNo} 页</strong>
              <button
                type="button"
                onClick={() => {
                  window.open(
                    `/api/export/page/${projectId}/${page.pageNo}`,
                    "_blank",
                    "noopener,noreferrer"
                  );
                }}
              >
                下载此页
              </button>
            </div>
            <PreviewCanvas page={page} scale={scale} template={template} theme={theme} />
          </div>
        ))}
      </div>
    </div>
  );
}
