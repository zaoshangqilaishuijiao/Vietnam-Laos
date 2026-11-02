#!/usr/bin/env node
/**
 * 共享日期工具：validate-trip-data.js 与 validate-guide-contract.js 统一引用，
 * 删除两处重复实现。错误消息保持与校验器既有文案一致（带前导"的"，由调用方拼标签）。
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 解析严格 YYYY-MM-DD 日期；无效（含 2026-02-30 之类 rollover）返回 null。
 * @param {string} value
 * @returns {Date|null}
 */
function parseIsoDate(value) {
  if (!ISO_DATE.test(value || "")) return null;
  const date = new Date(value + "T00:00:00Z");
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

/**
 * 生成 [start, end] 的连续日期清单（含首尾）。
 * @returns {{ dates: string[], error: string }} error 非空时 dates 为空数组。
 */
function buildDateRange(start, end) {
  const startDate = parseIsoDate(start);
  const endDate = parseIsoDate(end);
  if (!startDate || !endDate) return { dates: [], error: "的起止日期必须是有效的 YYYY-MM-DD。" };
  if (startDate > endDate) return { dates: [], error: "的结束日期早于开始日期。" };
  const count = Math.round((endDate - startDate) / DAY_MS) + 1;
  if (count > 2000) return { dates: [], error: "的日期范围异常，超过 2000 天。" };
  return {
    dates: Array.from({ length: count }, (_, index) => new Date(startDate.getTime() + index * DAY_MS).toISOString().slice(0, 10)),
    error: ""
  };
}

module.exports = { ISO_DATE, DAY_MS, parseIsoDate, buildDateRange };
