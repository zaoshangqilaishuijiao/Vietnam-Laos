// Research IDs remain private and stable; public reading numbers are a projection.
const READING_TOPICS = Object.freeze(["景点与文化", "街区玩法", "美食购物", "实用教程", "赛事资料"]);
const { xiaohongshuIdentity } = require('./xiaohongshu-identity.js');
const nonempty = value => typeof value === 'string' && Boolean(value.trim());
function readingSelection(data) {
  const seen = new Set();
  const sources = (Array.isArray(data.sources) ? data.sources : []).filter(source => {
    if (!source?.reading || !READING_TOPICS.includes(source.reading.topic) || !nonempty(source.reading.title) || !nonempty(source.reading.value)) return false;
    let url;
    try { url = new URL(source.url); } catch { return false; }
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    url.hash = '';
    const note = source.type === 'xiaohongshu' ? xiaohongshuIdentity(source.url) : null;
    if (source.type === 'xiaohongshu' && !note) return false;
    const key = note ? `xhs:${note}` : url.href;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const numbers = new Map(sources.map((source, index) => [source.id, index + 1]));
  const oldIndex = new Map((Array.isArray(data.sourceIndex) ? data.sourceIndex : []).map(item => [item?.sourceId, item]));
  const index = sources.map(source => {
    const item = oldIndex.get(source.id);
    return { sourceId: numbers.get(source.id), title: source.reading.title, cities: source.cities || [], tags: item?.tags || source.topics || [], searchHints: [source.reading.value, ...(item?.searchHints || [])] };
  });
  return { sources, numbers, index };
}
function projectReadingReferences(html, numbers) {
  // Only generated citation anchors are changed; action URLs and image credits stay intact.
  const projected = html.replace(/<a\b[^>]*class="source-ref"[^>]*href="#source-(\d+)"[^>]*>\[\d+\]<\/a>/g, (_anchor, id) => {
    const number = numbers.get(Number(id));
    return number ? `<a class="source-ref" href="#source-${number}" aria-label="查看补充阅读 ${number}">[${number}]</a>` : "";
  });
  return projected.replace(/<footer><span>补充阅读<\/span>\s*<\/footer>/g, '')
    .replace(/<p class="arrival-form-source">\s*<\/p>/g, '');
}
module.exports = { READING_TOPICS, readingSelection, projectReadingReferences };
