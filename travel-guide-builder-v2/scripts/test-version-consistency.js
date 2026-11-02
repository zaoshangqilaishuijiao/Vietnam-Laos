#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { PAGE_TEMPLATE_VERSION } = require("./shared-constants.js");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const templateLock = JSON.parse(fs.readFileSync(path.join(root, "assets", "page-template.lock.json"), "utf8"));
const capability = fs.readFileSync(path.join(root, "references", "capability-and-versioning.md"), "utf8");
const skill = fs.readFileSync(path.join(root, "SKILL.md"), "utf8");
const agent = fs.readFileSync(path.join(root, "agents", "openai.yaml"), "utf8");
const rules = fs.readFileSync(path.join(root, "references", "skill-rules.md"), "utf8");
const versions = {
  package: packageJson.version,
  packageLock: packageLock.version,
  packageLockRoot: packageLock.packages?.[""]?.version,
  template: templateLock.templateVersion,
  runtime: PAGE_TEMPLATE_VERSION
};

for (const [name, version] of Object.entries(versions)) {
  if (version !== PAGE_TEMPLATE_VERSION) {
    throw new Error(`版本不一致：${name}=${version || "缺失"}，预期 ${PAGE_TEMPLATE_VERSION}`);
  }
}
if (!capability.includes(`当前稳定版本为 **${PAGE_TEMPLATE_VERSION}**`)) {
  throw new Error("能力与版本决策索引中的当前稳定版本未同步。");
}
if (!skill.includes(`当前稳定版 ${PAGE_TEMPLATE_VERSION}`)) {
  throw new Error("SKILL.md 中的当前稳定版未同步。");
}
for (const [name, content, expected] of [
  ["SKILL.md 技能描述", skill, `旅行攻略规划与网页制作技能 ${PAGE_TEMPLATE_VERSION}`],
  ["SKILL.md 标题", skill, `# 旅行攻略制作 ${PAGE_TEMPLATE_VERSION}`],
  ["宿主展示名", agent, `display_name: "旅行攻略制作 ${PAGE_TEMPLATE_VERSION}"`],
  ["宿主默认提示词", agent, `按当前 ${PAGE_TEMPLATE_VERSION} 模板`],
  ["npm 包描述", packageJson.description, `旅行攻略制作 ${PAGE_TEMPLATE_VERSION}`],
  ["详细规则标题", rules, `# 旅行攻略制作 ${PAGE_TEMPLATE_VERSION} - 详细规则`]
]) {
  if (!content.includes(expected)) throw new Error(`${name} 未同步至 ${PAGE_TEMPLATE_VERSION}。`);
}

console.log(`PASS version consistency ${PAGE_TEMPLATE_VERSION}`);
