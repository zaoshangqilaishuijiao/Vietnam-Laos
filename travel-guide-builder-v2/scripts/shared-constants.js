#!/usr/bin/env node
/**
 * 跨脚本共享常量：小红书来源配额与公共资产哨兵。
 * validate-trip-data.js、validate-guide-contract.js、render-guide.js、combine-interactions-modules.js 统一引用，
 * 避免配额魔法数与资产哨兵版本在多个文件漂移。
 */
const XHS_GENERAL_REQUIRED_COUNT = 10;
const XHS_ARRIVAL_DEPARTURE_REQUIRED_COUNT = 3;
const GUIDE_DATA_VERSION = "2.0";
const PAGE_TEMPLATE_VERSION = '2.52.0';
const INTERACTIONS_ASSET_VERSION = 46;
const GUIDE_THEMES = [
  ["rainforest", "雨林绿"],
  ["coast", "海岸蓝"],
  ["terracotta", "暖陶土"],
  ["ink", "墨色"],
  ["burgundy", "勃艮第"],
  ["midnight", "午夜紫"]
];
const RECOMMENDATION_CATEGORIES = ["景点指南", "当地体验", "餐饮指南"];
const LOCAL_KNOWLEDGE_CATEGORIES = ["文化特点", "会客礼仪", "文化禁忌"];

// 公共资产哨兵（唯一来源）。升级共享资产时在此更新：combine-interactions-modules.js
// 据此生成版本头，validate-guide-contract.js 据此自对账，避免多文件手工同步漂移。
const ASSET_SENTINELS = [
  { file: "assets/ics-calendar.js", marker: "travel-guide-calendar: v2" },
  { file: "assets/travel-guide-interactions.js", marker: `travel-guide-interactions: v${INTERACTIONS_ASSET_VERSION}` },
  { file: "assets/travel-guide-interactions.css", marker: "travel-guide-interactions.css: v31" },
  { file: "assets/route-map.css", marker: "travel-route-map.css: v7" }
];

module.exports = {
  XHS_GENERAL_REQUIRED_COUNT,
  XHS_ARRIVAL_DEPARTURE_REQUIRED_COUNT,
  GUIDE_DATA_VERSION,
  PAGE_TEMPLATE_VERSION,
  INTERACTIONS_ASSET_VERSION,
  GUIDE_THEMES,
  RECOMMENDATION_CATEGORIES,
  LOCAL_KNOWLEDGE_CATEGORIES,
  ASSET_SENTINELS
};
