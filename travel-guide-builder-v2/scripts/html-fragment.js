#!/usr/bin/env node
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function scanElementBlock(html, attributeName, attributeValue) {
  const name = escapeRegExp(attributeName);
  const value = escapeRegExp(attributeValue);
  const source = String(html || "");
  const openPattern = new RegExp(`<([a-zA-Z][a-zA-Z0-9:-]*)\\b(?=[^>]*\\b${name}\\s*=\\s*(["'])${value}\\2)[^>]*>`, "i");
  const openMatch = openPattern.exec(source);
  if (!openMatch) return { found: false, fragment: null, error: null };
  const tagName = openMatch[1];
  const tagPattern = new RegExp(`<(/?)${escapeRegExp(tagName)}\\b[^>]*?(/?)>`, "gi");
  tagPattern.lastIndex = openMatch.index;
  let depth = 0;
  let match;
  while ((match = tagPattern.exec(source))) {
    if (match[2]) continue;
    depth += match[1] ? -1 : 1;
    if (depth === 0) return { found: true, fragment: source.slice(openMatch.index, tagPattern.lastIndex), error: null };
  }
  return { found: true, fragment: null, error: `${attributeName}="${attributeValue}" 的 <${tagName}> 标签未正确闭合` };
}

module.exports = { escapeRegExp, scanElementBlock };
