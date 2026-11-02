# 核验清单、天气与求雨彩蛋

本文件定义核验清单交互、天气刷新和求雨彩蛋的 DOM 契约与行为规则。完整攻略的 `checklist` 模块内嵌天气卡，天气始终是核验事项区最后一个功能块。

## 核验清单交互

- 使用一个带边框的 `guide-checklist-shell` 容纳全部内容。页面 HTML 只提供清单容器和 `data-checklist-items`；顶部"编辑清单"、常驻"添加确认项"输入框和"添加"按钮由共享交互脚本统一注入。不得在页面 HTML 中手写第二套工具栏。添加不依赖编辑模式；编辑模式只控制既有文字修改与删除按钮。
- 清单按"证件与入境、交通与预约、支付与通信、健康与安全、天气与临时管制"组织；每项使用稳定 `data-check`。默认勾选、编辑、添加和删除状态保存在 `localStorage`；启用共同编辑时，按 Supabase 协作契约同步允许的执行层状态，不上传路线、预算、来源或其他内容数据。
- 清单顶部显示完成数、百分比和进度条，并提供"全部 / 未完成 / 已完成"筛选；新增和删除后必须立即重算，筛选不得隐藏天气卡。
- 在全部预设项和自定义确认项下方、说明文字上方内嵌 `guide-weather-card`，并建议同时标记 `data-weather-card`。新增或恢复自定义项时必须插入天气卡之前；天气卡始终是核验事项区最后一个功能块，其后只允许本地保存等非事项说明。卡片标题为"出发前 7 天：天气查询"，右上角使用深色"刷新天气"按钮；说明预测窗口、行程日期和官方公告优先级。
- 复用 `assets/weather-card.html`：按住宿地、交通节点和户外活动范围填写地点名、英文名、经纬度和可选时区；不得写入示例地区。查询结果采用 Demo 的多地点卡片样式，固定显示日期、天气 / 温度、最高体感、雨量 / 雨时 / 最大降雨概率、最大阵风 / UV / 日落，并把建议压缩为"户外可行、带雨具、室内备选、船班核验、防晒、高温防晒"等关键词。
- 首次加载不请求接口、不展示伪装成实时值的示意数据；T-7 前禁用按钮并显示"T-7 开启"，同时用状态文字和 `title` 说明将在行程开始前 7 天开放，避免被误解为故障。进入窗口后仅由"刷新天气"请求 Open‑Meteo，失败保留正文并显示降级文案。台风、海况、道路、铁路、船班和航班公告优先于天气接口；卡底注明来源、无需 API Key、调用限制及不上传个人信息。
- 刷新成功后按日期汇总最高降雨概率及温度范围，同步写回对应 `.day[data-itinerary-date] [data-day-weather]`；摘要只存 `sessionStorage`，刷新页面可恢复，本地缓存不得伪装成新请求结果。
- 任一返回日期的最大降雨概率达到 80% 时，卡底才显示"如果下雨怎么办？请点击"；点击后在当前页上方打开求雨浮层。浮层必须使用 `assets/rain-prayer.html`：雨点随祈求进度逐步减少，100 次后转晴并向父页发送 `rain-prayer-complete`，父页收到后才显示关闭按钮。`scripts/render-guide.js` 在确定性渲染时直接读取并编码该资产，生成的 HTML 不得依赖外部文件、本机路径或二次嵌入脚本。
- 移动端工具栏换行，输入框保持足够宽度，天气表可横向滚动；刷新按钮、复选框和编辑控件不得互相遮挡。
- 所有清单卡片及其所在网格子项使用 `min-width:0; max-width:100%`；天气表和其他宽表格只能在各自滚动容器内横向滚动，不得造成 `document.documentElement.scrollWidth` 超过手机视口宽度。

## 天气刷新

天气只走 `initWeatherForecast()`：天气卡提供 `data-weather-card`、`data-weather-start-date="YYYY-MM-DD"`、`data-weather-end-date="YYYY-MM-DD"`、`data-weather-days="7"`、`data-rain-threshold="80"`，并用 `[data-weather-locations][type="application/json"]` 保存 `[{name,label,latitude,longitude,timezone?}]`。数据模型侧 `trip-data.weather.locations` 使用 `placeId` 引用地点库；渲染器装配页面 JSON 时按 `placeId` 回填 `label`（中文名 / 当地名）并透传可选 `timezone`，坐标仍须与 `places[]` 一致。共享资产自动判断 T-7 至行程结束的可刷新窗口、请求 Open‑Meteo、逐地点渲染成功或失败状态并处理条件彩蛋。完整攻略只传 `weather: true`；不得再内联 `fetchWeather`、`renderWeather` 或平行刷新逻辑。
