# 增量修改门禁

## 读取时机

仅在已有攻略需要局部调整时读取。新建完整攻略不需要加载本文件。

## 前置

- 保留旧 JSON 与旧 HTML 基线；不得删除基线。基线是**被 git 忽略的本地副本**（与主文件同目录、命名 `*.baseline.json` / `*.baseline.html`）：目录不进发布分支祖先链，禁止为基线配置 remote 或提交到任何分支；磁盘副本不进 AI 上下文。旧版 `*.before-*` 物理基线只读保留，经用户确认后可清理。
- 列出允许修改的 JSON 路径 `--allow-paths` 和冻结模块 `--frozen-modules`。冻结模块名使用 `data-guide-module`：`hero`、`arrival`、`route-map`、`itinerary`、`transport`、`budget`、`recommendations`、`checklist`、`bookings`、`sources`。
- 做 DOM 冻结时，旧 HTML 的 `data-guide-template-version` 必须与当前 `PAGE_TEMPLATE_VERSION` 一致。模板升级时仍须以**上一版正式数据**做 JSON 白名单对比，并提供上一版正式 HTML 作为内容/日期基线；此时不传 `--frozen-modules`，避免把旧模板的 DOM 当作新模板冻结。

## 执行

只改受影响的 `trip-data.json` 字段，HTML 始终由渲染器重建。修改前用 `node "<skill-root>/scripts/extract-trip-sections.js" <trip-data.json> --days=<N> --module=<模块>` 提取片段、改完用 `--apply` 写回（范围严格限定在命令声明的 day / module / item，原子替换）；AI 不通读全量 JSON：

```bash
node "<skill-root>/scripts/validate-trip-data.js" trip-data.json --stage=content --request=trip-request.json --brief=trip-brief.json --baseline=old-trip-data.json --allow-paths=<白名单>
node "<skill-root>/scripts/render-guide.js" trip-data.json guide.html --request=trip-request.json --brief=trip-brief.json --baseline=old-trip-data.json --allow-paths=<白名单> --baseline-html=old-guide.html --frozen-modules=<冻结模块> [--freeze-action=fail|restore]
```

- JSON 白名单外差异直接失败。
- 冻结模块按完整 DOM 片段和内嵌数据比对。默认 `fail`；`restore` 仅用于诊断，不能写出可交付成品；必须回滚对应 JSON 后重渲，使 JSON 与页面一致。
- 没有上游 JSON 的旧 HTML 可做受影响范围修补；若会持续维护，应先迁移出 JSON 基线。
- 默认复用既有研究、地点和无关模块；只对受影响范围做一次定向验收。未获授权不得允许日期删除。
- 门禁参数中的 `--baseline` / `--baseline-html` 指向本地基线文件路径（不支持 git ref）；对比结论以校验器输出为准，AI 不人工通读新旧全量 JSON。
- 同一攻略的后续版本（含只升级模板）必须从最近一次已确认的 `trip-data.json` 继续修改，不能以更早版本、缩短版或预览副本为起点。`--baseline` 指最近一次已确认的数据，`--baseline-html` 指同一发布路径上一版正式 HTML；即使仅重渲模板，`--allow-paths` 仍要显式声明实际变化范围。报告记录输入与基线的完整本地路径、哈希及连续性状态；新版 HTML 另携带不含正文的内容指纹，供下一次发布证明 JSON 基线与正式页面对应。首次创建新攻略不要求基线。
