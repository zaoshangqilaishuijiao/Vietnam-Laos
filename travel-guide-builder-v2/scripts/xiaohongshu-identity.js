// Count notes, not share URLs. No network requests or token removal from stored links.
function xiaohongshuIdentity(value) {
  try {
    const url = new URL(String(value || '').replace(/&amp;/g, '&'));
    if (!/^https?:$/.test(url.protocol) || !/^(?:www\.)?xiaohongshu\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/(?:explore|search_result)\/([a-z0-9_-]+)\/?$/i);
    return match ? match[1].toLowerCase() : null;
  } catch (_) { return null; }
}
function validateXiaohongshuIdentities(sources) {
  const ids = sources.filter(s => s?.type === 'xiaohongshu').map(s => xiaohongshuIdentity(s.url));
  if (ids.some(id => !id)) return '小红书来源须保存实际打开后的笔记长链（explore/search_result）；短链或候选页不能计入已读篇数。';
  if (new Set(ids).size !== ids.length) return '小红书笔记 ID 必须去重，同一篇的分享参数或不同入口不能重复计数。';
  return null;
}
module.exports = { xiaohongshuIdentity, validateXiaohongshuIdentities };
