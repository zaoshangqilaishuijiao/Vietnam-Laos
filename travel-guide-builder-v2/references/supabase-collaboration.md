# Supabase 共同编辑执行状态

仅用于预订状态、简短执行备注、清单勾选、自定义事项，以及已识别的机票执行信息；路线、研究、来源与基础行程仍来自静态 `trip-data.json`。

## 修改边界

- 锁定：路线、日期、地点、逐日时间线、交通方案、预算基准、地图点位、风险提示与资料来源。需要调整时修改 `trip-data.json` 并重新渲染。
- 共享：预订状态、简短执行备注、系统清单勾选、用户新增确认项及其文案、勾选/删除状态。
- 本机：搜索历史、地图缩放位置、天气与汇率刷新结果、实际支出、个人临时标记。
- 系统生成的核验项只能勾选，不能在网页中改文案或删除；用户自定义项可以新增、编辑文案、勾选和删除；文案为 1–240 字，编辑模式下同步。

## 初始化

1. 新项目在 Supabase SQL Editor 按 001_shared_execution_state.sql → 002_align_custom_checklist.sql → 003_persistent_device_collaboration.sql → 004_lww_execution_save.sql → 005_flight_records_sync.sql → 006_flight_sync_hardening.sql → 007_custom_checklist_text_limit.sql → 008_remove_legacy_collab_overloads.sql → 009_execution_authorization.sql 顺序执行；已经按旧版本建表的项目，从缺失的最早迁移起补执行。
2. 在 Authentication 启用 Anonymous Sign-ins；本机匿名身份用于恢复设备会话，实际有效期由服务配置决定，不要求邮箱或密码。
3. 在 Database > Replication 将 `guide_execution_state`、`guide_checklist_state`、`guide_custom_checklist`、`guide_flight_records` 加入 `supabase_realtime`。
4. 只在发布环境配置 Project URL 与 publishable key；绝不向浏览器提供 `service_role`/`sb_secret_` key。渲染器与部署构建器必须解析密钥类型，只接受 `sb_publishable_` 或旧版 `role=anon` JWT，不能只检查非空。

009 修复新建房间八位码校验，撤销执行状态和清单的直接写表权限，恢复及保存同时检查成员与设备。保留首位用户设码创建 owner 的个人使用流程，不增加初始化凭证。旧项目补执行 009，无业务记录删除；新 guideId 统一为 8–80 字符。

006仅补执行一次：撤销航班表直接写权限，写入统一走成员及设备鉴权的RPC，校验字段和敏感链接；锁住同一攻略后整组替换，保留航段顺序。007仅将自定义清单 RPC 的截断上限与表约束统一为 240 字符，不删除或改写既有记录。008删除已被三参数设备会话接口替代的两参数协作函数，并在确实存在两份同列唯一约束时移除 002 产生的冗余约束；不删除业务记录。线上执行需用户单独确认；普通攻略、排版更新不执行SQL，也不重跑旧迁移。

## 使用规则

- 首位点击“编辑行程”的用户输入新的 8 位数字码，成为 owner。
- 其他设备输入同一码后成为 editor；首次之后使用持久匿名会话。
- owner 更换数字码后，后续新设备必须使用新码；既有成员会话不会自动失效，若需彻底收回权限应在控制台删除对应成员。
- 所有状态更新按服务器收到 RPC 的顺序最后写入者生效，并保留 `updated_at`、`updated_by` 和设备标识；浏览器时间不参与覆盖判断。该简单 LWW 由 `004_lww_execution_save.sql` 的三组保存 RPC 承载。
- 不保存订单号、证件、付款信息、完整邮件或笔记原文。
- 机票图片、图片键、OCR 全文、二维码、条码、订单号、票号、PNR、乘机人和证件信息不得进入 Supabase。仅同步已识别的航班执行信息与安全的 HTTPS 购票链接；图片始终只保留在上传设备。

## 持久设备与自动保存

- 首次编辑输入 8 位数字协作码；浏览器取得匿名会话后保存稳定 `guideId`（房间 ID）和随机 `deviceToken`。同一设备再次打开时先恢复匿名会话，再以二者恢复编辑身份；无效时保持只读。
- 攻略身份不得随标题、日期或输出路径改变。旧攻略从基线 JSON、基线 HTML 或同路径旧输出继承 `guideId`；没有基线时才固定旧算法身份。
- 编辑状态明确显示“编辑中 · 已同步”“保存中…”或“保存失败”；失败必须提供重试。退出编辑前强制保存，成功后退出设备会话、清除本机身份并执行本地 `signOut`；失败时不得伪装为已退出。
- 所有允许编辑的变化进入内存 dirty 队列，同一实体连续修改只保留最后状态。机票执行信息与其他状态共用同一个 Supabase 客户端和保存队列。
- 默认防抖 1500ms。保存响应只能确认本次发送的队列项，请求期间产生的新修改继续保留；不得依赖客户端时间戳决定覆盖顺序。
- `visibilitychange` 进入 hidden 和 `pagehide` 时尽力 `flush()`；存在未保存内容时由 `beforeunload` 触发浏览器原生确认。只有页面内“退出编辑”等待保存成功，才是可靠保存出口。
- 不保留本地协作草稿，不比较客户端时钟，不弹出恢复或合并对话框；服务器当前状态是协作层唯一数据源。

## 服务端一致性

- 每次保存携带 `guideId`、`deviceToken` 和增量内容；兼容参数 `clientUpdatedAt` 不参与覆盖仲裁。服务端按 RPC 到达顺序执行简单 LWW，并记录服务端 `updated_at` 与设备标识。
- 当前状态继续使用 `guide_execution_state`、`guide_checklist_state`、`guide_custom_checklist` 和 `guide_flight_records`，不得为历史版本创建平行表。
- 不承诺固定会话天数或设备数量上限；需要撤销设备时在控制台移除对应设备会话。
- 003 负责持久设备会话和 `pgcrypto` schema，004 定义执行状态、清单及自定义事项的 LWW RPC；函数使用 `extensions.crypt`、`extensions.gen_salt`，并设置 `search_path = public, extensions`。
## 页面接入与降级

- 渲染器仅从用户私有目录读取 supabase.local.json 的 projectUrl 与 publishableKey；新攻略未配置时不输出协作脚本，网页保持完全离线可用。但基线 HTML 或同路径旧输出已声明 `collaboration` 时，缺配置必须中止；只有用户明确要求关闭时才使用 `--no-collaboration`。公开 Pages 需要保留编辑时，使用 `--public-source --public-collaboration` 生成 CI 占位符源文件。
- 页面默认只读；点击“编辑行程”或任一预定状态后打开同一个 8 位数字码对话框。首次成功进入后维持匿名成员会话，不在每次修改时重复询问数字码。进入或恢复编辑后必须订阅三个状态表的 `postgres_changes`；逐日状态/短备注、预定清单三态、标准清单和自定义事项通过 Realtime 回写。订阅失败时保存仍可用，但必须提示刷新页面获取他人修改。
- 预订备注仅写执行提示；不得填订单号、证件、支付信息或完整笔记。
- 预定清单的共享实体 ID 固定为 `booking:<bookingLedger.id>`；活动/门票映射 `entity_type=activity`，餐厅/用餐映射 `entity_type=meal`，复用现有 `guide_execution_state`，不新增平行表。
- 预定清单进入共同编辑后按“已预订 → 待预订 → 待核验”循环；服务器加载或 Realtime 回写时必须保留 `.booking-status` 类、按钮位置和三态文案。
- 未配置 Supabase 时不输出协作入口，预定清单使用本机 `localStorage` 降级；已配置但尚未进入编辑时，不允许状态静默变化。进入编辑后以服务器已有记录优先，未同步的本机状态不自动上传。
- 保存失败时保留明确错误提示；不得只改变界面而宣称服务器已同步。页面隐藏或退出时，保存队列以 `keepalive` 尽力提交；它不替代失败提示、重试与退出前等待。
- Supabase SDK 是版本锁定的 jsDelivr 公开依赖，仅在启用共同编辑时加载；不得改回浮动大版本。无法用实际字节核验 SRI 的动态加载资源不伪造 integrity，更新其版本须纳入共享资产审查与回归。
- 浏览器端只加载 publishable key；RLS 与 RPC 负责授权。任何 service role key 均不得进入私有配置、生成 HTML 或仓库。
