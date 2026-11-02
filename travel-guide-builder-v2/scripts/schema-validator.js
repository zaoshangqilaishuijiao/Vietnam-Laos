#!/usr/bin/env node
/**
 * 轻量级 JSON Schema 前置校验层。
 * 不引入 ajv 等外部依赖，仅做基础结构检查
 * （required/properties/type/enum/const），
 * 具体值约束仍由 validate-trip-data.js 详细逻辑处理。
 *
 * 目标：以与输入规模线性相关的开销拦截明显结构错误，
 *      减少后续深入校验的无效扫描。
 */

const fs = require("fs");
const path = require("path");

const SCHEMA_PATH = path.resolve(__dirname, "../references/trip-data.schema.json");
let _schemaCache = null;

/* 各阶段必填顶层字段——schema.required 仅定义 content 阶段全集，
   request/brief 是渐进式子集，由下表覆盖。 */
const STAGE_REQUIRED_FIELDS = {
  request: ["schemaVersion", "stage", "meta", "features", "requirements", "researchPlan"],
  brief: ["schemaVersion", "stage", "meta", "features", "requirements", "researchPlan",
          "route", "dayOutline", "researchSources", "researchAudit", "confirmation"],
  content: ["schemaVersion", "stage", "meta", "features",
            "places", "route", "days", "transport", "budget",
            "recommendations", "checklist",
            "bookingLedger", "weather", "researchAudit", "sources"]
};

function loadSchema() {
  if (_schemaCache) return _schemaCache;
  const raw = fs.readFileSync(SCHEMA_PATH, "utf8");
  _schemaCache = JSON.parse(raw);
  return _schemaCache;
}

function matchesType(value, type) {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

/* 递归执行轻量结构校验；复杂 oneOf / anyOf、格式、范围和业务约束
   仍交给 validate-trip-data.js。 */
function validateNode(value, nodeSchema, prefix, options = {}) {
  const errors = [];
  const location = prefix || "$";

  if (!nodeSchema || typeof nodeSchema !== "object") return errors;
  if (nodeSchema.$ref) {
    const match = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(nodeSchema.$ref);
    const target = match && loadSchema().$defs?.[match[1]];
    return target ? validateNode(value, target, location, options) : [`${location} 使用了无法解析的 schema 引用。`];
  }
  if (value === null && nodeSchema.nullable === true) return errors;

  if (nodeSchema.type && !matchesType(value, nodeSchema.type)) {
    errors.push(`${location} 类型应为 ${nodeSchema.type}。`);
    return errors;
  }

  if (Object.prototype.hasOwnProperty.call(nodeSchema, "const") && value !== nodeSchema.const) {
    errors.push(`${location} 必须等于 ${JSON.stringify(nodeSchema.const)}。`);
  }
  if (Array.isArray(nodeSchema.enum) && !nodeSchema.enum.includes(value)) {
    errors.push(`${location} 必须是 ${nodeSchema.enum.map((item) => JSON.stringify(item)).join("、")} 之一。`);
  }

  if (Array.isArray(value)) {
    if (nodeSchema.items) {
      value.forEach((item, index) => {
        errors.push(...validateNode(item, nodeSchema.items, `${location}[${index}]`));
      });
    }
    return errors;
  }

  if (value === null || typeof value !== "object") return errors;

  const required = options.required || nodeSchema.required;
  if (Array.isArray(required)) {
    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${location} 缺少必填字段 "${key}"。`);
      }
    }
  }

  if (nodeSchema.additionalProperties === false && nodeSchema.properties) {
    const allowedKeys = new Set(Object.keys(nodeSchema.properties));
    for (const key of Object.keys(value)) {
      if (!allowedKeys.has(key)) {
        errors.push(`${location} 包含未定义的字段 "${key}"。`);
      }
    }
  }

  if (nodeSchema.properties) {
    for (const [key, childSchema] of Object.entries(nodeSchema.properties)) {
      if (key in value) {
        errors.push(...validateNode(value[key], childSchema, `${location}.${key}`));
      }
    }
  }

  return errors;
}

function validateStructure(data, stage) {
  const schema = loadSchema();

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return ["JSON 根节点必须是对象。"];
  }

  const targetStage = stage || data.stage || "content";
  const requiredFields = STAGE_REQUIRED_FIELDS[targetStage] || STAGE_REQUIRED_FIELDS.content;
  return validateNode(data, schema, "$", { required: requiredFields });
}

// CLI 入口
if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args[0];
  if (!file) {
    console.error("Usage: node schema-validator.js <trip-data.json>");
    process.exit(2);
  }

  try {
    const raw = fs.readFileSync(path.resolve(file), "utf8");
    const data = JSON.parse(raw);
    const errors = validateStructure(data, data.stage);

    if (errors.length > 0) {
      console.error(`Schema 结构校验失败 (${errors.length} 个错误):\n- ${errors.join("\n- ")}`);
      process.exit(1);
    } else {
      console.log("Schema 结构校验通过");
      process.exit(0);
    }
  } catch (error) {
    console.error(`读取文件失败: ${error.message}`);
    process.exit(2);
  }
}

module.exports = { loadSchema, matchesType, validateNode, validateStructure };
