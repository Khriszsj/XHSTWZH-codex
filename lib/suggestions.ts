import { docToPlainText } from "./doc";
import type { RichDoc } from "./types";

interface SuggestionResult {
  titles: string[];
  tags: string[];
}

function extractKeywords(input: string): string[] {
  const matched = input.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,10}/g) ?? [];
  const blacklist = new Set(["我们", "你们", "然后", "就是", "这个", "那个", "可以", "已经"]);
  const freq = new Map<string, number>();

  for (const token of matched) {
    const normalized = token.trim().toLowerCase();
    if (!normalized || blacklist.has(normalized)) {
      continue;
    }

    freq.set(normalized, (freq.get(normalized) ?? 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key]) => key);
}

export function buildSuggestions(doc: RichDoc): SuggestionResult {
  const plainText = docToPlainText(doc);
  const keywords = extractKeywords(plainText);
  const core = keywords[0] ?? "干货";
  const secondary = keywords[1] ?? "实用技巧";

  const titles = [
    `这篇${core}总结，建议先收藏再看`,
    `把${core}讲透：新手也能马上上手`,
    `${core}避坑清单：我踩过的坑都写在这`,
    `一篇搞定${core}，附${secondary}流程`,
    `${core}实战记录：从0到1复盘`
  ];

  const tags = [
    ...keywords.map((word) => `#${word}`),
    "#小红书运营",
    "#内容创作",
    "#干货分享",
    "#博主日常"
  ];

  return {
    titles,
    tags: [...new Set(tags)].slice(0, 15)
  };
}
