import fs from "node:fs";
import path from "node:path";
import { docToPlainText } from "./doc";
import type { RichDoc } from "./types";

const RISK_WORD_FILE = path.join(process.cwd(), "storage", "risk_words.txt");

export interface ComplianceIssue {
  word: string;
  count: number;
  suggestion: string;
}

function loadRiskWords(): string[] {
  if (!fs.existsSync(RISK_WORD_FILE)) {
    return [];
  }

  return fs
    .readFileSync(RISK_WORD_FILE, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function checkCompliance(doc: RichDoc): ComplianceIssue[] {
  const text = docToPlainText(doc);
  const words = loadRiskWords();
  const issues: ComplianceIssue[] = [];

  for (const word of words) {
    const count = text.split(word).length - 1;
    if (count > 0) {
      issues.push({
        word,
        count,
        suggestion: `建议将“${word}”替换为更中性表达`
      });
    }
  }

  return issues;
}
