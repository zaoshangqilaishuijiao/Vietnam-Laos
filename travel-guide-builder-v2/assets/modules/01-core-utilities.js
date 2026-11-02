/* ── 01  core utilities ── */
const text = (value) => String(value || "").trim();
const normalize = (value) => text(value).toLowerCase().replace(/\s+/g, " ");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const prefersReducedMotion = () => global.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

const chineseTerms = (query) => {
  const normalized = normalize(query);
  const segments = normalized.match(/[\u4e00-\u9fff]+/g) || [];
  const pairs = segments.flatMap((segment) => [...segment].map((_, index) => segment.slice(index, index + 2)).filter((item) => item.length === 2));
  return [...new Set(normalized.split(" ").filter(Boolean).concat(segments, pairs))].sort((a, b) => b.length - a.length);
};


function readJsonIndex(selector, root = document) {
  const script = root.querySelector(selector);
  if (!script) return [];
  try { return JSON.parse(script.textContent || "[]"); } catch (error) { global.console?.warn?.(`旅行攻略数据索引解析失败：${selector}`, error); return []; }
}
