# Google My Maps 本地导出（Pinbook）

用户要求将攻略地点整理到 Google My Maps 时，先以已确认的 `trip-data.json` 为唯一地点来源，运行本地导出脚本。Pinbook 1.3.0 安装在 `tools/pinbook`，其 Codex 编写指南也安装在用户技能目录。导出入口：

```bash
node scripts/export-pinbook-map.js --input=outputs/<攻略>/trip-data.json --output=outputs/<攻略>/my-maps
```

默认 `--scope=itinerary` 只导出逐日正式条目和住宿锚点。需要扩展时选择：

| 范围 | 地点 |
| --- | --- |
| `--scope=nearby` | 正式地点，加上 `nearbyDays[]` 中显示日的“附近逛逛”候选。 |
| `--scope=recommended` | 正式地点，加上 `recommendations[]`、`venueSuggestions[]` 中已研究的具名地点；其中当天“附近逛逛”仍单独标识。 |
| `--scope=all` | 兼容原有用法，导出地点库内全部地点，包括未采用的地点；不作为默认推荐地图。 |

候选须先通过 `targetType/targetId → recommendation/venueSuggestion → placeId` 解析，再引用 `places[]`；隐藏日的候选不当作“附近逛逛”，但如它本身是已研究推荐，仍会进入 `recommended` 范围。`--country=老挝` 可筛选国家，`--limit=6` 可做小型演示。输出 `index.yaml` 供后续人工编辑，`.pinbook/map.kml` 供 Google My Maps 手动导入。

按“正式行程／附近逛逛／其他推荐／地点库其他地点”分层，不再按城市占用图层；图钉说明保留城市、国家及涉及的 D 日编号。地点同时属于多个类别时只生成一枚图钉，优先放正式行程层，其次附近逛逛、其他推荐；说明中仍保留多重归属。图钉颜色与地点类型图标使用 Pinbook 支持的值，不影响攻略网页六套主题。使用地点库中现有坐标，不自动解析地址、不上传照片、不调用 Google API；Pinbook 的 `photo` 仅接受远端 HTTP(S) 图片，因此本地攻略图片仍在网页中查看。

导出时跳过缺失或无效坐标，并在终端列出 ID；若没有可用地点则停止。`verificationStatus` 会写入标记说明，但导出不代表坐标已核验。先核对地点库与实际行程，再在 My Maps 中导入 KML 并检查标记位置、分层和可见性。My Maps 导入是用户账号内的一张独立地图，不会自动加入 Google 地图的“已收藏”清单，也不会随源 JSON 自动同步。后续改动应重新导出、再手动重新导入。Pinbook 只导出地点图钉，不导出 `dayRoadRoutes[]`；实际道路、日期切换及候选开关继续由攻略网页逐日地图负责。

导出文件只保留在本地 `outputs/` 下（已被 Git 忽略）。若要把 KML 上传到用户 Google 账号，先向用户展示生成结果并按其明确指令操作；不要把私人攻略或“个人能力建设”材料发布到公开仓库。
