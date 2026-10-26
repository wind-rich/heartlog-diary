# 心意簿 HeartLog

记录伴侣的基础信息、兴趣偏好、照片、日常生活、心情、健康和重要事件，支持回顾总结与导出备份。

**本地优先**：所有记录默认只存在你自己的设备（浏览器 IndexedDB）里；不登录时应用**不会上传任何数据**，完全离线可用。AI 与云端备份都是可选功能。

---

## 快速开始

```bash
npm install          # 首次安装依赖
npm run dev          # 开发模式，默认 http://localhost:5288
npm run build        # 生产构建，产物在 dist/
npm run preview      # 预览构建产物
```

在手机上使用：

1. 手机与电脑连同一个 WiFi；
2. 用手机浏览器打开电脑的局域网地址（`npm run dev` 会打印，形如 `http://192.168.x.x:5288`）；
3. iPhone：Safari → 分享 → 「添加到主屏幕」；Android：Chrome → 菜单 → 「安装应用」。

> 建议同时 `npm run dev` 和浏览器访问都用同一种方式，数据是按「浏览器 + 站点来源」隔离保存的。

---

## 功能一览

作者端与访客端**共用同一套页面**（作者端多出编辑入口与设置），不再维护两套界面。

| 页面 | 内容 |
| --- | --- |
| 宇宙首页 | 以中心人物为轴的节点视图，可点开预览并进入完整列表；作者端多一条「首页提醒」卡 |
| 故事 | 按时间浏览记录，支持筛选与详情；作者端可新增 / 编辑 / 删除 |
| 相册 | 按时间浏览照片、看大图；作者端可上传 / 删除 |
| 档案 | 人物资料、偏好、心愿、礼物、健康、每日状态、画像、纪念日、历史回顾（作者端可增删改） |
| 记着（作者） | 待办与站内提醒：六分组、完成/撤销/稍后、完成后转公开回忆 |
| 回忆录（作者） | 人工整理长文；可选 AI 草稿（只用选定范围的记录、保留引用、人工改过不覆盖） |
| 互动（访客+作者） | 记忆配对小游戏：只用已发布照片，成绩只存本地浏览器，作者可开关 |
| 设置（作者） | AI 配置、云服务与多端同步、发布到展示端、文稿包导出、备份体检、展示端互动开关 |

### 两种记录入口

- **快速记录**：一句话 + 照片 + 标签，适合每天随手写。
- **完整记录**：发生时间、事件类型、标题、具体经过、TA 说了什么、我的观察、当天心情与程度、照片、标签、后续事项。

「TA 说了什么」与「我的观察」**分开保存** —— 前者是 TA 的直接表达，后者是你自己的判断。这一区分会让 AI 总结更准确。

### 偏好不会把一次偶然当成习惯

每条兴趣偏好都可以记录 **喜欢程度**、**最近确认时间**、**依据记录**。画像条目则区分三种依据强度：

- TA 明确表达过
- 多次记录体现的倾向
- 暂时需要进一步观察

### 关于星座与健康

- 星座由公历生日自动计算（农历生日会先换算），允许手动覆盖；**只作为档案展示，不会用来推断性格**。
- 健康记录只用于记录与跟进，**不用于推断疾病**，AI 也不给医疗建议。
- 农历、节气、传统节日全部在**本地计算**，断网也能正常显示，不依赖任何外部接口。

---

## AI 配置（可选）

应用支持任何 OpenAI 兼容接口（DeepSeek、通义、OpenAI 等），有两种接入方式。

### 方式一：直连（简单）

设置 → AI 增强 → 接入方式选「直连模型接口」，填入接口地址、API Key、模型名 → 点「测试连接」。

> 密钥保存在本机浏览器的 IndexedDB 里，只在你自己的设备上。缺点：部分模型服务不允许浏览器跨域（CORS），会连接失败。

### 方式二：自建代理（推荐，密钥不落浏览器）

项目自带一个零依赖的转发脚本：

```bash
# Windows PowerShell
$env:HL_UPSTREAM="https://api.deepseek.com/v1"
$env:HL_API_KEY="sk-你的密钥"
$env:HL_MODEL="deepseek-chat"
npm run proxy          # 默认监听 http://127.0.0.1:8787
```

然后在设置里选「经自建代理」，代理地址填 `http://127.0.0.1:8787/v1`。

脚本只监听本机地址，请不要直接暴露到公网。健康检查：`http://127.0.0.1:8787/health`。

### AI 的隐私边界

- 调用前会让你逐项选择：是否包含「我的观察」与私人备注、是否包含健康记录（**默认不含健康记录**）。
- 照片分析是**独立开关**，默认关闭。
- 所有 AI 结论都要求标注引用的记录编号（如 `[E3]`），找不到依据时必须直说「记录不足」。
- 未配置 AI 时，记录、检索、统计、画像手动维护、导出与备份全部照常可用。

---

## 云服务（可选）

应用已接入 WorkBuddy 云服务，提供四块能力，共用一个环境：**邮箱登录/注册**、**云端备份与恢复**、**免密钥模型调用**、**云端对象存储**。

### 设计取舍：本地优先，云端有三条独立通道

本地 IndexedDB 是**编辑时的真相源**，但三件事各自独立，不要混为一谈：

- **多端同步（私有）**：手机与电脑登录同一账号后「双向同步」，业务行按 `updatedAt` 较新者胜合并，被覆盖的那一版会留**冲突副本**（可取回 / 忽略 / 清理）；删除走本地墓碑上行。照片二进制走对象存储，行里只存路径。
- **发布到展示端（公开）**：把当前内容整理成**只读快照**写入云端，访客端匿名读；带版本历史、差异预览、历史回退与**真正撤回**（撤回后访客看到提示页，不回退旧静态内容）。
- **云端备份（手工）**：整包推上去，用于换设备恢复；「合并」只补本机没有的，「覆盖」先清空再还原。**它是按钮触发的，没有定时任务。**

照片在云端**按 photoId 去重存放**，多份备份与发布共用同一批对象，不会重复占用空间。

对象存储布局：

```
users/<uid>/heartlog/photos/<photoId>.<ext>          照片原图（去重）
users/<uid>/heartlog/photos/thumb_<photoId>.<ext>    缩略图
users/<uid>/heartlog/backups/<backupKey>/backup.json 一次备份的完整载荷
```

数据库 `heartlog_backups` 表只登记元信息（时间、条数、大小、照片 id 列表），用于在界面上列出历史备份与清理孤儿照片。表启用了 RLS，四类策略都是 `owner_id = auth.uid()`，**数据按账号隔离，其他账号看不到**；前端不发送 `owner_id`，由数据库的 `DEFAULT auth.uid()` 填。

### 免密钥 AI

设置 → AI 增强 → 接入方式选「云服务（免密钥）」，登录后即可使用，**不需要自己填 API Key**。模型列表取自云服务（`cloud.llm.models.list`）；不指定模型时会依次尝试前几个可用模型——因为列表里存在路由型条目（如 `auto`）可能不产出内容，只靠名称猜是不可靠的。

另外两种接入方式（直连 / 自建代理）仍然保留，用于接你自己的模型服务。

### 配置

云配置集中在 `src/lib/cloudConfig.ts` 的 `CLOUD_PUBLIC_CONFIG`，是**唯一**允许进入前端产物的云配置（`endpoint` / `publishableKey` / `oauthRelayBaseUrl` / `resourceId`）。这四个值本身不带权限，鉴权由服务端按 Origin 精确匹配完成。

> ⚠️ 改动发布域名后 `endpoint` 会失效，需要重新开通/发布并更新该文件。
> ⚠️ 不要把 endpoint 写到别处，也不要从 `location` / 环境变量推导。

---

## 导出与备份

两种留存方式，用途不同：

| 格式 | 用途 | 内容 |
| --- | --- | --- |
| 文稿包（Markdown 目录） | 给人读 / 归档 / 迁移 | `README.md` + `index.md` + `records/<年>.md` + `archive/*.md` + `memoirs/*.md` + `data/index.json` + `media/photos/`；锚点就是数据 id，图片用相对路径 |
| ZIP 完整备份 | 给机器恢复 | `manifest.json`（版本号，当前 v3）+ `data.json`（全部记录）+ `photos/`（原图与缩略图） |

文稿包在 设置 →「导出文稿包（Markdown）」导出，可关掉照片只留文字、也可按时间段导出；README 会写明数据来源与上次同步时间。完整备份在 设置 →「完整备份与恢复」，顶部还有一块**备份体检**（显示上次导出距今几天、云端备份时间），用来提醒「该导出了」。

> 旧版「PDF / 单文件 Markdown」导出（`src/components/ExportDialog.tsx`）仍在代码里，但它只被旧的「回顾」页面引用，而那个页面已不在导航中——**当前界面没有 PDF / 单文件 Markdown 入口**。需要时再决定是否把它接回新界面。

恢复时支持两种模式：

- **合并（推荐）**：已存在的记录不覆盖；id 相同的跳过，事件还会按「同一发生时间 + 同一标题」再判一次重。
- **覆盖**：先清空本机数据，再完整恢复，适合换设备迁移。

> 数据存在浏览器里，清理浏览器数据会导致记录丢失。**请定期导出完整备份。**

---

## 技术栈与目录

- 前端：React 18 + TypeScript + Vite 5
- 样式：Tailwind CSS（暖色系，移动端优先）
- 存储：IndexedDB（Dexie），照片以 Blob 保存，缩略图与原图分离
- PWA：自定义 `manifest.webmanifest` + Service Worker（离线可用）
- 农历/星座/节日：`lunar-javascript`（纯本地算法）
- 导出：JSZip + 专用打印页
- 云服务：`@tencent-ai/workbuddy-cloud-sdk`（Auth / Database / Storage / LLM 四模块共用一个环境）

```
src/
  db/          types.ts（数据模型）、db.ts（Dexie schema 与 CRUD）
  lib/         date / photo / query / stats / exporter / backup / ai / constants
               cloudConfig.ts（云配置）、cloud.ts（客户端单例）、cloudAuth.ts（邮箱登录）、
               cloudBackup.ts（云端备份与恢复）
  components/  ui.tsx、EntryEditor、ExportDialog（旧）、CloudPanel、SyncPanel、PublishPanel、
               BackupHealth、BundleExportPanel、StartGate
  pages/       Settings（作者端设置：AI / 云 / 发布 / 导出 / 备份 / 互动）
  viewer/      展示端：ViewerApp（访客入口）、entry（SW 自愈）、pages/（Home/Stories/Album/
               Archive/RecordDetail/Tasks/Memoir/Game）、components/Shell、data/（local/cloud/sample）、
               author/（编辑组件，全部懒加载）、game/、state/
  tasks/       待办与提醒契约、模型、本机仓库、私有同步、通知能力、转公开回忆
  memoir/      回忆录模型、读写与 AI 草稿
  state/       app.tsx（人物、设置与登录态上下文）
server/proxy.mjs            AI 服务端代理（零依赖）
scripts/gen-icons.mjs       PWA 图标生成（零依赖，构建前自动执行）
verify/verify-e2e.mjs       本地/线上功能端到端验证（Chrome CDP，零依赖）
verify/verify-cloud.mjs     云服务连通性与模型调用验证（需在已发布域名下运行）
```

> PWA 图标由脚本生成，不入库。克隆后直接 `npm run build` 会自动生成；也可单独执行 `npm run icons`。

### 数据结构

`Person` `Preference` `Entry` `DailyStatus` `HealthRecord` `Gift` `Wish` `Photo` `PortraitInsight` `Summary`
`Task` `TaskReminder` `TaskOccurrence` `Memoir`（Dexie 现为 **v5**：v2 墓碑、v3 冲突副本、v4 待办三表、v5 回忆录）

- 所有记录使用稳定 id（字符串），照片二进制单独存放、其余表只引用 `photoId`，便于导出与后续跨设备同步。
- 第一版只管理一个人物，但所有记录都带 `personId`，数据结构天然支持多人物。

---

## 端到端验证

仓库带一套真实浏览器验证脚本（Chrome DevTools Protocol 驱动，无需 Playwright / Puppeteer 等依赖）。

现行套件（都需要先 `npm run dev`，各自用独立临时 Chrome profile，产物写入 `verify/_artifacts/`）：

```bash
npm run verify:sync     # 同步引擎 + 发布一致性（83 项）
npm run verify:tasks    # 待办与提醒（91 项）
npm run verify:bundle   # 文稿包与回忆录（33 项）
npm run verify:game     # 记忆配对（33 项逻辑 + 浏览器全流程）
npm run verify:v4       # 旧库增量升级到 v5（17 张表）
npm run verify:author   # 作者/访客隔离、空设备、导入、未配置 AI 也能导出
node verify/verify-author-ui.mjs   # 作者端界面回归（含回忆录全流程）
node verify/verify-tasks-ui.mjs    # 待办界面（390 / 1440）
node verify/verify-publish-site.mjs # 发布产物：两入口不串包
node verify/verify-live-tasks.mjs   # 线上产物核查（会访问线上域名）
```

> `npm run verify`（`verify-e2e.mjs`）与 `npm run verify:cloud` 是早期脚本：前者针对**已下线的旧导航**（今天/时间线/回顾），现在跑会失败，仅作历史保留；后者只验云端连通性与模型调用，仍可在已发布域名下使用。

也可以指定被测地址，同一个脚本可用来验证生产构建或线上版本：

```bash
# 构建产物
npm run build && npm run preview            # 假设监听 4290
HL_BASE=http://127.0.0.1:4290 npm run verify

# 线上版本
HL_BASE=https://heartlog-diary.app.workbuddy.host npm run verify
```

云服务另有一套连通性验证（**必须在已发布的 HTTPS 域名下跑**，因为服务端按 Origin 精确匹配，localhost 会被拒）：

```bash
npm run verify:cloud
```

它会注入官方 SDK 并检查：域名与凭证链可用、模型列表可达、**真实发起一次流式模型调用并校验返回内容**、未登录时数据库被 RLS 正确拒绝（返回 0 行而非鉴权失败）、未登录访问对象存储被拒绝且给出明确错误。

> 需要真实邮箱收码的部分（邮箱登录、云端备份读写）不在这套自动验证里 —— 那一步需要在界面上用你自己的邮箱完成。

```

> 早期 `verify-e2e.mjs` 曾覆盖 62 项断言（持久化 / 补记排序 / 增删改查 / 照片双入口 / 导出 / 备份恢复 / 降级 / 稳定性），但它锚定的是旧导航，**已不再作为当前回归依据**。现行覆盖范围见上面各套件的括号说明。

截图与下载产物写入 `verify/_artifacts/`（已忽略，不入库）。
`verify/probe-persist.mjs` 是排查「刷新后数据丢失」用的探针脚本，保留下来作为根因定位的记录。

环境变量：`HL_BASE`（被测地址）、`HL_CHROME`（Chrome 路径，默认自动探测）、`HL_OUT`（产物目录）。

---

## 已知边界

- 数据按浏览器隔离：换浏览器或清理站点数据后看不到原记录，请用完整备份迁移。
- **多端合并是有损的**：同一条记录两边都改时「较新者胜」，被覆盖的那一版进冲突副本（可手动取回），不做字段级合并；两台设备同时改同一条仍会丢一半（见 `docs/context/DECISIONS.md` D-018）。
- **发布与部署是两件事**：改代码要部署，改内容/展示配置要在作者端点「发布到展示端」。
- 农历闰月生日会按「当月 + 闰月」顺序寻找匹配日期，极端情况下与部分万年历有 1 天差异。
- PDF 采用「专用打印页 + 浏览器另存为 PDF」方案，图片用缩略图内联以保证文件体积与分页稳定。

---

## 开源许可

本项目基于 [MIT License](LICENSE) 开源。
