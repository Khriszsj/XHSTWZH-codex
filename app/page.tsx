"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PagePreview } from "@/components/PagePreview";
import { RichEditor } from "@/components/RichEditor";
import { getTemplate, TEMPLATES } from "@/lib/defaults";
import { createId } from "@/lib/id";
import { BACKGROUND_PRESETS } from "@/lib/presets";
import type { InlineNode, PageRender, Project, RichDoc, ThemeVars } from "@/lib/types";

interface ProjectSummary {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
}

interface ComplianceIssue {
  word: string;
  count: number;
  suggestion: string;
}

interface Suggestions {
  titles: string[];
  tags: string[];
}

function normalizeHexColor(color: string, fallback: string): string {
  const normalized = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) {
    return normalized;
  }

  const match = normalized.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) {
    return fallback;
  }

  const toHex = (value: string) => Number(value).toString(16).padStart(2, "0");
  return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`;
}

function normalizeProject(project: Project): Project {
  const template = getTemplate(project.templateId);
  const themeVars: ThemeVars = {
    ...template.defaultTheme,
    ...project.themeVars,
    imageStylePreset:
      project.themeVars.imageStylePreset ||
      template.defaultTheme.imageStylePreset ||
      "soft-shadow"
  };

  return {
    ...project,
    themeVars,
    templateId: template.id
  };
}

function normalizeInlineNode(node: InlineNode): Record<string, unknown> {
  if (node.type === "hardBreak") {
    return { type: "hardBreak" };
  }

  const marks = node.marks
    ? {
        bold: Boolean(node.marks.bold),
        color: node.marks.color || "",
        fontSize: node.marks.fontSize ?? null,
        lineHeight: node.marks.lineHeight ?? null,
        letterSpacing: node.marks.letterSpacing ?? null,
        paddingInline: node.marks.paddingInline ?? null
      }
    : null;

  return {
    type: "text",
    text: node.text,
    marks
  };
}

function normalizeDocForCompare(doc: RichDoc): Record<string, unknown> {
  return {
    id: doc.id,
    title: doc.title,
    nodes: doc.nodes.map((node) => {
      if (node.type === "image") {
        return {
          type: "image",
          assetId: node.assetId,
          src: node.src,
          width: node.width,
          height: node.height,
          align: node.align,
          caption: node.caption || ""
        };
      }

      return {
        type: "paragraph",
        spacingAfter: node.spacingAfter ?? null,
        children: node.children.map((child) => normalizeInlineNode(child))
      };
    })
  };
}

function isSameDocContent(a: RichDoc, b: RichDoc): boolean {
  return JSON.stringify(normalizeDocForCompare(a)) === JSON.stringify(normalizeDocForCompare(b));
}

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [pages, setPages] = useState<PageRender[]>([]);
  const [selectedPageNo, setSelectedPageNo] = useState(1);

  const [warnings, setWarnings] = useState<string[]>([]);
  const [issues, setIssues] = useState<ComplianceIssue[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestions>({ titles: [], tags: [] });

  const [message, setMessage] = useState("准备就绪");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [history, setHistory] = useState<RichDoc[]>([]);
  const [future, setFuture] = useState<RichDoc[]>([]);
  const [presetKeyword, setPresetKeyword] = useState("");
  const [libraryTab, setLibraryTab] = useState<"library" | "adjust">("library");

  const hydrationRef = useRef(true);

  const activeTemplate = useMemo(() => {
    if (!project) {
      return TEMPLATES[0];
    }
    return TEMPLATES.find((item) => item.id === project.templateId) ?? TEMPLATES[0];
  }, [project]);

  const filteredBackgrounds = useMemo(() => {
    const keyword = presetKeyword.trim().toLowerCase();
    if (!keyword) {
      return BACKGROUND_PRESETS;
    }

    return BACKGROUND_PRESETS.filter((item) =>
      `${item.name} ${item.description}`.toLowerCase().includes(keyword)
    );
  }, [presetKeyword]);

  const filteredTemplates = useMemo(() => {
    const keyword = presetKeyword.trim().toLowerCase();
    if (!keyword) {
      return TEMPLATES;
    }

    return TEMPLATES.filter((item) => item.name.toLowerCase().includes(keyword));
  }, [presetKeyword]);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      const payload = (await response.json()) as { projects: ProjectSummary[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "加载项目失败");
      }

      const existing = payload.projects || [];
      setProjects(existing);

      if (!existing.length) {
        const created = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "我的第一篇小红书长文" })
        });
        const createdPayload = (await created.json()) as { project: Project; error?: string };
        if (!created.ok) {
          throw new Error(createdPayload.error || "创建项目失败");
        }

        const normalized = normalizeProject(createdPayload.project);
        setProject(normalized);
        setProjects([
          {
            id: normalized.id,
            title: normalized.title,
            createdAt: normalized.createdAt,
            updatedAt: normalized.updatedAt
          }
        ]);
      } else {
        const target = await fetch(`/api/projects/${existing[0].id}`, { cache: "no-store" });
        const targetPayload = (await target.json()) as { project: Project; error?: string };
        if (!target.ok) {
          throw new Error(targetPayload.error || "读取项目失败");
        }

        setProject(normalizeProject(targetPayload.project));
      }

      setMessage("项目已加载");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "初始化失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const recalc = useCallback(async (docProject: Project) => {
    const [paginateRes, complianceRes, suggestionRes] = await Promise.all([
      fetch("/api/paginate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc: docProject.doc,
          templateId: docProject.templateId,
          themeVars: docProject.themeVars
        })
      }),
      fetch("/api/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: docProject.doc })
      }),
      fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: docProject.doc })
      })
    ]);

    const paginatePayload = (await paginateRes.json()) as {
      pages: PageRender[];
      warnings: string[];
      error?: string;
    };
    const compliancePayload = (await complianceRes.json()) as {
      issues: ComplianceIssue[];
      error?: string;
    };
    const suggestionPayload = (await suggestionRes.json()) as Suggestions & { error?: string };

    if (!paginateRes.ok) {
      throw new Error(paginatePayload.error || "分页失败");
    }
    if (!complianceRes.ok) {
      throw new Error(compliancePayload.error || "合规检查失败");
    }
    if (!suggestionRes.ok) {
      throw new Error(suggestionPayload.error || "建议生成失败");
    }

    setPages(paginatePayload.pages || []);
    setWarnings(paginatePayload.warnings || []);
    setIssues(compliancePayload.issues || []);
    setSuggestions({
      titles: suggestionPayload.titles || [],
      tags: suggestionPayload.tags || []
    });
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!project) {
      return;
    }

    const timer = window.setTimeout(() => {
      void recalc(project).catch((error) => {
        setMessage(error instanceof Error ? error.message : "预览计算失败");
      });
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [project, recalc]);

  useEffect(() => {
    if (!pages.length) {
      return;
    }

    if (!pages.some((item) => item.pageNo === selectedPageNo)) {
      setSelectedPageNo(pages[0].pageNo);
    }
  }, [pages, selectedPageNo]);

  useEffect(() => {
    if (!project) {
      return;
    }

    if (hydrationRef.current) {
      hydrationRef.current = false;
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        setIsSaving(true);
        const response = await fetch(`/api/projects/${project.id}/content`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: project.title,
            templateId: project.templateId,
            themeVars: project.themeVars,
            doc: project.doc
          })
        });

        const payload = (await response.json()) as { project: Project; error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "保存失败");
        }

        const normalized = normalizeProject(payload.project);

        setProjects((prev) => {
          const next = prev.filter((item) => item.id !== normalized.id);
          return [
            {
              id: normalized.id,
              title: normalized.title,
              createdAt: normalized.createdAt,
              updatedAt: normalized.updatedAt
            },
            ...next
          ];
        });
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "自动保存失败");
      } finally {
        setIsSaving(false);
      }
    }, 900);

    return () => {
      window.clearTimeout(timer);
    };
  }, [project]);

  const updateDoc = useCallback((nextDoc: RichDoc) => {
    setProject((current) => {
      if (!current) {
        return current;
      }

      const normalizedNext: RichDoc = {
        ...nextDoc,
        id: nextDoc.id || createId("doc")
      };

      // Avoid duplicate history snapshots when blur emits the same content again.
      if (isSameDocContent(current.doc, normalizedNext)) {
        return current;
      }

      setHistory((stack) => [...stack.slice(-49), current.doc]);
      setFuture([]);

      return {
        ...current,
        doc: normalizedNext,
        updatedAt: Date.now()
      };
    });
  }, []);

  const handleThemeChange = useCallback((patch: Partial<ThemeVars>) => {
    setProject((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        themeVars: {
          ...current.themeVars,
          ...patch
        },
        updatedAt: Date.now()
      };
    });
  }, []);

  const applyBackgroundPreset = useCallback(
    (presetId: string) => {
      const preset = BACKGROUND_PRESETS.find((item) => item.id === presetId);
      if (!preset) {
        return;
      }
      handleThemeChange(preset.patch);
      setMessage(`已应用页面皮肤：${preset.name}（整篇 1080×1440 页面已同步）`);
    },
    [handleThemeChange]
  );

  const undo = useCallback(() => {
    setProject((current) => {
      if (!current || history.length === 0) {
        return current;
      }

      const previous = history[history.length - 1];
      setHistory((stack) => stack.slice(0, -1));
      setFuture((stack) => [current.doc, ...stack].slice(0, 50));

      return {
        ...current,
        doc: previous,
        updatedAt: Date.now()
      };
    });
  }, [history]);

  const redo = useCallback(() => {
    setProject((current) => {
      if (!current || future.length === 0) {
        return current;
      }

      const [nextDoc, ...rest] = future;
      setFuture(rest);
      setHistory((stack) => [...stack.slice(-49), current.doc]);

      return {
        ...current,
        doc: nextDoc,
        updatedAt: Date.now()
      };
    });
  }, [future]);

  const exportAll = useCallback(async () => {
    if (!project) {
      return;
    }

    try {
      setMessage("正在导出...");
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id })
      });

      const payload = (await response.json()) as {
        error?: string;
        downloadUrl?: string;
        imageCount?: number;
      };

      if (!response.ok || !payload.downloadUrl) {
        throw new Error(payload.error || "导出失败");
      }

      window.open(payload.downloadUrl, "_blank", "noopener,noreferrer");
      setMessage(`导出完成，共 ${payload.imageCount ?? 0} 张图片`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导出失败");
    }
  }, [project]);

  if (loading || !project) {
    return <main className="app-shell">加载中...</main>;
  }

  const selectedBackgroundId =
    BACKGROUND_PRESETS.find(
      (preset) =>
        preset.patch.pageBackground === project.themeVars.pageBackground &&
        preset.patch.textColor === project.themeVars.textColor
    )?.id || "";

  return (
    <main className="app-shell">
      <section className="app-topbar">
        <div className="topbar-info">
          <strong>小红书长文转图工作台</strong>
          <div className="topbar-sub">本地编辑 / 所见即所得 / 模板库换肤</div>
        </div>

        <div className="topbar-actions">
          <label className="field-inline">
            <span>项目</span>
            <select
              value={project.id}
              onChange={async (event) => {
                const id = event.target.value;
                const response = await fetch(`/api/projects/${id}`, { cache: "no-store" });
                const payload = (await response.json()) as { project: Project; error?: string };
                if (!response.ok) {
                  setMessage(payload.error || "切换项目失败");
                  return;
                }
                hydrationRef.current = true;
                setHistory([]);
                setFuture([]);
                setProject(normalizeProject(payload.project));
              }}
            >
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={async () => {
              const response = await fetch("/api/projects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: `新建笔记 ${new Date().toLocaleString()}` })
              });
              const payload = (await response.json()) as { project: Project; error?: string };
              if (!response.ok) {
                setMessage(payload.error || "新建项目失败");
                return;
              }

              const normalized = normalizeProject(payload.project);
              hydrationRef.current = true;
              setProjects((prev) => [
                {
                  id: normalized.id,
                  title: normalized.title,
                  createdAt: normalized.createdAt,
                  updatedAt: normalized.updatedAt
                },
                ...prev
              ]);
              setHistory([]);
              setFuture([]);
              setProject(normalized);
            }}
          >
            新建项目
          </button>

          <button type="button" onClick={undo} disabled={!history.length}>
            撤销
          </button>
          <button type="button" onClick={redo} disabled={!future.length}>
            重做
          </button>
          <button type="button" onClick={() => void exportAll()}>
            导出发布包
          </button>
        </div>
      </section>

      <section className="studio-layout">
        <aside className="panel left-rail">
          <div className="panel-header">
            <strong>页面</strong>
            <span>
              {selectedPageNo}/{pages.length}
            </span>
          </div>

          <div className="page-rail-list">
            {pages.map((page) => (
              <button
                key={page.pageNo}
                type="button"
                className={`page-rail-item ${selectedPageNo === page.pageNo ? "is-active" : ""}`}
                onClick={() => setSelectedPageNo(page.pageNo)}
                title={`跳转第 ${page.pageNo} 页`}
              >
                <span>{page.pageNo}</span>
              </button>
            ))}
          </div>

          <div className="rail-block">
            <strong>快捷页面皮肤</strong>
            <div className="quick-swatches">
              {BACKGROUND_PRESETS.slice(0, 5).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`swatch-btn ${selectedBackgroundId === preset.id ? "is-active" : ""}`}
                  onClick={() => applyBackgroundPreset(preset.id)}
                  title={preset.name}
                >
                  <span style={{ background: preset.preview }} />
                </button>
              ))}
            </div>
          </div>

        </aside>

        <section className="editor-stack">
          <section className="panel project-meta">
            <div className="toolbar project-toolbar">
              <label className="title-field">
                <span>标题</span>
                <input
                  type="text"
                  value={project.title}
                  onChange={(event) =>
                    setProject((current) =>
                      current
                        ? {
                            ...current,
                            title: event.target.value,
                            updatedAt: Date.now()
                          }
                        : current
                    )
                  }
                />
              </label>

              <span className="save-status">{isSaving ? "保存中..." : "已自动保存"}</span>
              <span className="save-message">{message}</span>
            </div>
          </section>

          <RichEditor
            projectId={project.id}
            doc={project.doc}
            onDocChange={updateDoc}
            onCommandFeedback={setMessage}
          />

          <section className="panel insight-panel">
            <div className="panel-header">
              <strong>发布辅助</strong>
              <span>{issues.length ? `风险词 ${issues.length}` : "合规通过"}</span>
            </div>

            <div className="meta-grid compact">
              <div>
                <strong>风险词</strong>
                {issues.length ? (
                  <div className="chips danger">
                    {issues.map((item) => (
                      <span key={item.word} className="chip">
                        {item.word} x{item.count}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span>未发现风险词</span>
                )}
              </div>

              <div>
                <strong>标题候选</strong>
                <div className="chips">
                  {suggestions.titles.slice(0, 4).map((title) => (
                    <span key={title} className="chip">
                      {title}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <strong>标签建议</strong>
                <div className="chips">
                  {suggestions.tags.slice(0, 6).map((tag) => (
                    <span key={tag} className="chip">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {warnings.length > 0 ? (
                <div>
                  <strong>分页提醒</strong>
                  <div className="chips">
                    {warnings.slice(0, 3).map((warning) => (
                      <span key={warning} className="chip">
                        {warning}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </section>

        <PagePreview
          compact
          projectId={project.id}
          template={activeTemplate}
          theme={project.themeVars}
          pages={pages}
          selectedPageNo={selectedPageNo}
          onSelectPage={setSelectedPageNo}
        />

        <aside className="panel template-library">
          <div className="panel-header">
            <div className="library-tabs">
              <button
                type="button"
                className={libraryTab === "library" ? "is-active" : ""}
                onClick={() => setLibraryTab("library")}
              >
                模板库
              </button>
              <button
                type="button"
                className={libraryTab === "adjust" ? "is-active" : ""}
                onClick={() => setLibraryTab("adjust")}
              >
                调整
              </button>
            </div>
            <span>即时生效</span>
          </div>

          {libraryTab === "library" ? (
            <>
              <div className="template-search">
                <input
                  type="text"
                  value={presetKeyword}
                  onChange={(event) => setPresetKeyword(event.target.value)}
                  placeholder="搜索模板、页面皮肤"
                />
              </div>

              <div className="library-section">
                <h4>版式模板</h4>
                <div className="preset-grid template-grid">
                  {filteredTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className={`preset-card compact ${project.templateId === template.id ? "is-active" : ""}`}
                      onClick={() => {
                        const nextTemplate = getTemplate(template.id);
                        setProject((current) =>
                          current
                            ? {
                                ...current,
                                templateId: nextTemplate.id,
                                themeVars: {
                                  ...nextTemplate.defaultTheme,
                                  footerSignature: current.themeVars.footerSignature
                                },
                                updatedAt: Date.now()
                              }
                            : current
                        );
                        setMessage(`已切换版式模板：${nextTemplate.name}`);
                      }}
                    >
                      <div className="preset-meta">
                        <strong>{template.name}</strong>
                        <span>
                          {template.canvasWidth} x {template.canvasHeight}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="library-section">
                <h4>页面皮肤（作用于全部页面）</h4>
                <div className="preset-grid">
                  {filteredBackgrounds.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`preset-card ${selectedBackgroundId === preset.id ? "is-active" : ""}`}
                      onClick={() => applyBackgroundPreset(preset.id)}
                    >
                      <div
                        className="preset-swatch"
                        style={{ background: preset.preview }}
                      />
                      <div className="preset-meta">
                        <strong>{preset.name}</strong>
                        <span>{preset.description}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

            </>
          ) : (
            <div className="library-section">
              <h4>全局调整</h4>
              <div className="adjust-grid">
                <label>
                  文字颜色
                  <input
                    type="color"
                    value={normalizeHexColor(project.themeVars.textColor, "#111827")}
                    onChange={(event) =>
                      handleThemeChange({
                        textColor: normalizeHexColor(event.target.value, "#111827")
                      })
                    }
                  />
                </label>

                <label>
                  背景色
                  <input
                    type="color"
                    value={normalizeHexColor(project.themeVars.pageBackground, "#fffaf4")}
                    onChange={(event) =>
                      handleThemeChange({
                        pageBackground: normalizeHexColor(event.target.value, "#fffaf4")
                      })
                    }
                  />
                </label>

                <label>
                  基础字号
                  <select
                    value={String(project.themeVars.bodyFontSize)}
                    onChange={(event) =>
                      handleThemeChange({ bodyFontSize: Number(event.target.value) })
                    }
                  >
                    {[28, 32, 36, 40, 44].map((size) => (
                      <option key={size} value={size}>
                        {size}px
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  页脚签名
                  <input
                    type="text"
                    value={project.themeVars.footerSignature}
                    onChange={(event) =>
                      handleThemeChange({ footerSignature: event.target.value })
                    }
                  />
                </label>
              </div>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
