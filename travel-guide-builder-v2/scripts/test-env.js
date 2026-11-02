#!/usr/bin/env node
/**
 * 测试环境依赖统一入口（被动检测）。
 * 不主动探测环境：DOM 测试真正用到 jsdom 时才惰性加载；
 * 单独运行 DOM 脚本时，缺失可打印安装提示并跳过；
 * 全量回归通过环境变量要求依赖完整，缺失必须失败，避免假通过。
 */
function requireJsdom() {
  try {
    return require("jsdom").JSDOM;
  } catch (error) {
    if (process.env.TRAVEL_GUIDE_REQUIRE_JSDOM === "1") {
      throw new Error("jsdom 未安装：全量回归不能跳过 DOM 测试，请先运行 npm ci。", { cause: error });
    }
    console.error("jsdom 未安装：跳过 DOM 测试。请先运行 npm install 安装 devDependencies。");
    return null;
  }
}

module.exports = { requireJsdom };
