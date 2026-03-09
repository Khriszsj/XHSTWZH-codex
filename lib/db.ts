import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createDefaultDoc, getTemplate } from "./defaults";
import { createId } from "./id";
import { DB_PATH, ensureStorage } from "./storage";
import type { Asset, Project, RichDoc, Snapshot, ThemeVars } from "./types";

ensureStorage();

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  template_id TEXT NOT NULL,
  theme_vars TEXT NOT NULL,
  doc_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  doc_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  local_path TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS export_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  zip_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
`);

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function toProject(row: {
  id: string;
  title: string;
  template_id: string;
  theme_vars: string;
  doc_json: string;
  created_at: number;
  updated_at: number;
}): Project {
  return {
    id: row.id,
    title: row.title,
    templateId: row.template_id,
    themeVars: parseJson<ThemeVars>(row.theme_vars),
    doc: parseJson<RichDoc>(row.doc_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    snapshots: []
  };
}

export function createProject(title?: string): Project {
  const now = Date.now();
  const id = createId("project");
  const resolvedTitle = title || "未命名笔记";
  const doc = createDefaultDoc(resolvedTitle);
  const template = getTemplate();
  const themeVars = template.defaultTheme;

  db.prepare(
    `INSERT INTO projects (id, title, template_id, theme_vars, doc_json, created_at, updated_at)
     VALUES (@id, @title, @template_id, @theme_vars, @doc_json, @created_at, @updated_at)`
  ).run({
    id,
    title: resolvedTitle,
    template_id: template.id,
    theme_vars: JSON.stringify(themeVars),
    doc_json: JSON.stringify(doc),
    created_at: now,
    updated_at: now
  });

  createSnapshot(id, doc);

  return {
    id,
    title: resolvedTitle,
    templateId: template.id,
    themeVars,
    doc,
    createdAt: now,
    updatedAt: now,
    snapshots: listSnapshots(id)
  };
}

export function listProjects(): Array<Pick<Project, "id" | "title" | "updatedAt" | "createdAt">> {
  const rows = db
    .prepare(
      `SELECT id, title, updated_at, created_at
       FROM projects
       ORDER BY updated_at DESC`
    )
    .all() as Array<{ id: string; title: string; updated_at: number; created_at: number }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at,
    createdAt: row.created_at
  }));
}

export function getProject(id: string): Project | null {
  const row = db
    .prepare(
      `SELECT id, title, template_id, theme_vars, doc_json, created_at, updated_at
       FROM projects
       WHERE id = ?`
    )
    .get(id) as
    | {
        id: string;
        title: string;
        template_id: string;
        theme_vars: string;
        doc_json: string;
        created_at: number;
        updated_at: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  const project = toProject(row);
  project.snapshots = listSnapshots(id);
  return project;
}

export function saveProjectContent(params: {
  id: string;
  title: string;
  templateId: string;
  themeVars: ThemeVars;
  doc: RichDoc;
}): Project {
  const now = Date.now();

  db.prepare(
    `UPDATE projects
     SET title = @title,
         template_id = @template_id,
         theme_vars = @theme_vars,
         doc_json = @doc_json,
         updated_at = @updated_at
     WHERE id = @id`
  ).run({
    id: params.id,
    title: params.title,
    template_id: params.templateId,
    theme_vars: JSON.stringify(params.themeVars),
    doc_json: JSON.stringify(params.doc),
    updated_at: now
  });

  createSnapshot(params.id, params.doc);
  trimSnapshots(params.id, 20);

  const project = getProject(params.id);
  if (!project) {
    throw new Error("Project not found after save");
  }
  return project;
}

function createSnapshot(projectId: string, doc: RichDoc): void {
  db.prepare(
    `INSERT INTO snapshots (id, project_id, doc_json, created_at)
     VALUES (@id, @project_id, @doc_json, @created_at)`
  ).run({
    id: createId("snap"),
    project_id: projectId,
    doc_json: JSON.stringify(doc),
    created_at: Date.now()
  });
}

function trimSnapshots(projectId: string, maxCount: number): void {
  const rows = db
    .prepare(
      `SELECT id
       FROM snapshots
       WHERE project_id = ?
       ORDER BY created_at DESC`
    )
    .all(projectId) as Array<{ id: string }>;

  if (rows.length <= maxCount) {
    return;
  }

  const stale = rows.slice(maxCount).map((row) => row.id);
  const stmt = db.prepare(`DELETE FROM snapshots WHERE id = ?`);

  const tx = db.transaction((snapshotIds: string[]) => {
    for (const snapshotId of snapshotIds) {
      stmt.run(snapshotId);
    }
  });

  tx(stale);
}

function listSnapshots(projectId: string): Snapshot[] {
  const rows = db
    .prepare(
      `SELECT id, doc_json, created_at
       FROM snapshots
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT 20`
    )
    .all(projectId) as Array<{ id: string; doc_json: string; created_at: number }>;

  return rows.map((row) => ({
    id: row.id,
    doc: parseJson<RichDoc>(row.doc_json),
    at: row.created_at
  }));
}

export function createAsset(params: {
  projectId: string;
  type: string;
  width: number;
  height: number;
  localPath: string;
  hash: string;
}): Asset {
  const id = createId("asset");
  const createdAt = Date.now();

  db.prepare(
    `INSERT INTO assets (id, project_id, type, width, height, local_path, hash, created_at)
     VALUES (@id, @project_id, @type, @width, @height, @local_path, @hash, @created_at)`
  ).run({
    id,
    project_id: params.projectId,
    type: params.type,
    width: params.width,
    height: params.height,
    local_path: params.localPath,
    hash: params.hash,
    created_at: createdAt
  });

  return {
    id,
    projectId: params.projectId,
    type: params.type,
    width: params.width,
    height: params.height,
    localPath: params.localPath,
    hash: params.hash,
    createdAt
  };
}

export function getAsset(id: string): Asset | null {
  const row = db
    .prepare(
      `SELECT id, project_id, type, width, height, local_path, hash, created_at
       FROM assets
       WHERE id = ?`
    )
    .get(id) as
    | {
        id: string;
        project_id: string;
        type: string;
        width: number;
        height: number;
        local_path: string;
        hash: string;
        created_at: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    width: row.width,
    height: row.height,
    localPath: row.local_path,
    hash: row.hash,
    createdAt: row.created_at
  };
}

export function registerExportJob(projectId: string, zipPath: string): string {
  const id = createId("export");
  db.prepare(
    `INSERT INTO export_jobs (id, project_id, zip_path, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(id, projectId, zipPath, Date.now());
  return id;
}

export function getExportPath(exportId: string): string | null {
  const row = db
    .prepare(`SELECT zip_path FROM export_jobs WHERE id = ?`)
    .get(exportId) as { zip_path: string } | undefined;

  return row?.zip_path ?? null;
}

export function ensureProjectAssetDir(projectId: string): string {
  const dir = path.join(process.cwd(), "storage", "assets", projectId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
