#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { validateStructure } = require("./schema-validator");

const assetsDir = path.resolve(__dirname, "../assets/data");
const templates = [
  "trip-request.template.json",
  "trip-brief.template.json",
  "trip-data.template.json"
];

for (const name of templates) {
  const data = JSON.parse(fs.readFileSync(path.join(assetsDir, name), "utf8"));
  const errors = validateStructure(data, data.stage);
  if (errors.length) {
    throw new Error(`${name} 不应产生结构错误：\n${errors.join("\n")}`);
  }
}

const content = JSON.parse(fs.readFileSync(path.join(assetsDir, "trip-data.template.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../references/trip-data.schema.json"), "utf8"));
const itemSchema = schema.properties.days.items.properties.items.items;
if (!JSON.stringify(itemSchema.allOf || []).includes('navigationMode') || !JSON.stringify(itemSchema.allOf || []).includes('navigationOptions')) {
  throw new Error("trip-data.schema.json 未声明 navigationMode/navigationOptions 互斥契约。");
}
const malformed = {
  ...content,
  schemaVersion: "9.9",
  features: "weather",
  places: {},
  unexpectedField: true
};
const errors = validateStructure(malformed, "content");
const expectedFragments = [
  "$.schemaVersion 必须等于",
  "$.features 类型应为 object",
  "$.places 类型应为 array",
  '$ 包含未定义的字段 "unexpectedField"'
];

for (const fragment of expectedFragments) {
  if (!errors.some((message) => message.includes(fragment))) {
    throw new Error(`未拦截预期结构错误：${fragment}\n实际错误：\n${errors.join("\n")}`);
  }
}

const missing = { ...content };
delete missing.days;
const missingErrors = validateStructure(missing, "content");
if (!missingErrors.some((message) => message.includes('缺少必填字段 "days"'))) {
  throw new Error("未拦截 content 阶段缺少 days。");
}

console.log(`通过：Schema 前置校验正向与负向测试（${errors.length + missingErrors.length} 个错误被正确拦截）`);
