# ReSwap 二手闲置物品交换平台

```bash
pnpm install
pnpm dev
```

访问地址：`http://localhost:18415`

## 项目介绍

ReSwap 是一个纯前端以物换物 Web 应用。用户可以本地模拟登录、发布闲置物品、浏览他人物品、发起交换请求，并在浏览器内管理交换记录。

## 主要功能

- 首页瀑布流浏览、分类筛选、关键词搜索。
- 物品详情、物主资料、选择自己的物品发起交换。
- 发布物品，支持本地 base64 图片上传、分类和成色选择。
- 交换管理，区分我发起的和我收到的请求，支持同意、拒绝、完成。
- 个人中心，编辑资料、上传头像、查看我发布的物品。
- 主题切换、全局错误处理和 Vant 提示。

## 启动与构建

```bash
pnpm install
pnpm dev
```

```bash
pnpm build
```

生产部署：执行 `pnpm build` 后，将 `dist/` 目录交给 Nginx 或任意静态文件服务器托管。

## 技术栈

| 类型 | 技术 |
| --- | --- |
| 框架 | Vue 3 + TypeScript |
| 构建 | Vite |
| 状态管理 | Pinia |
| 路由 | Vue Router 4 |
| UI | Vant + Tailwind CSS |
| 持久化 | localStorage + IndexedDB（idb-keyval） |
| 工具库 | dayjs、lodash-es |

## 项目目录结构

```text
src/
├── api/              # userApi.ts, itemApi.ts, exchangeApi.ts, batchApi.ts：本地数据 API 层
├── stores/           # authStore.ts, itemStore.ts, exchangeStore.ts, recoveryStore.ts, themeStore.ts
├── models/           # user.ts, item.ts, exchange.ts：独立数据模型（含 revision 修订号）
├── types/            # 共享类型补充（修订冲突、可重试批次）
├── components/common/# ItemCard、CategoryFilter、ExchangeCard、PendingBatchPanel 等
├── hooks/            # useAuth.ts, useLocalStorage.ts, useExchangeStats.ts, useRemoteRefresh.ts
├── pages/            # Home, ItemDetail, Publish, Exchanges, Profile
├── router/           # index.ts + guards.ts
├── utils/            # storage.ts, migrations.ts, revision.ts, runBatch.ts, rebaseBatch.ts, formatters.ts 等
├── constants/        # item.ts, exchange.ts, themes.ts, messages.ts
├── App.vue
├── main.ts
└── styles.css
```

## 数据持久化说明

- `utils/storage.ts` 统一封装 localStorage 和 IndexedDB，信封带 `version`（当前为 v2）。
- 所有 `api/*Api.ts` 通过 `storage.ts` 读写数据，不在组件里直接写业务数据。
- 存储层包含序列化、版本号、过期清理、存储 key 管理。
- 首次启动会写入演示用户、物品和交换请求。

### 修订号（乐观锁）与可恢复提交

为解决“两个标签页同时改一笔交换，旧页面把刚写入的结果盖回去”的问题：

- `Item` / `Exchange` 各带递增的 `revision` 修订号与 `updated_at`；每次写入 +1。
- 发起交换携带两侧物品的修订信息；同意 / 拒绝 / 完成携带交换与两侧物品的修订信息；下架携带物品自身修订信息。
- 提交时页面修订与存储中的有效版本不一致（或物品已换出/已下架）即抛 `RevisionMismatchError`：**保留页面输入**，列出对方改动，并引导基于最新数据重做。
- 交换与物品状态在同一批次内校验、一次整表写入，保证“一起成功，否则不留半成品”。
- 发起交换携带幂等键 `request_key`，失败重试不会重复生成交换记录；同意 / 拒绝 / 完成本身按动作幂等。
- 失败的提交会写入 `reswap:pending-batches`（`api/batchApi.ts`、`stores/recoveryStore.ts`、`utils/runBatch.ts`、`utils/rebaseBatch.ts`），交换管理页可用 `PendingBatchPanel` 查看对方改动、基于最新数据重试或放弃；应用启动时自动回放仍是 pending 的批次。
- 监听浏览器 `storage` 事件（`hooks/useRemoteRefresh.ts`），首页、详情、交换页在另一标签页写入后立即认同最新有效版本。
- 旧的 v1 数据在读取时由 `utils/migrations.ts` 自动迁移：补 `revision = 1` 与 `updated_at`，信封升级到 v2，不需要手工清库。

## 横切关注点

- 主题切换：`stores/themeStore.ts`、`constants/themes.ts`、`utils/themeUtils.ts`、`App.vue`、`components/common/CategoryFilter.vue`、`components/common/UserBrief.vue`、`components/common/ItemCard.vue`。
- 全局错误处理/提示：`utils/message.ts`、`components/common/GlobalErrorBoundary.tsx`、`stores/authStore.ts`、`stores/itemStore.ts`、`stores/exchangeStore.ts`、`components/common/ImageUploader.vue`。

## 枚举出现位置清单

### ItemStatus

定义位置：`src/constants/item.ts`

出现位置：

- `src/models/item.ts`
- `src/constants/messages.ts`
- `src/api/itemApi.ts`
- `src/api/exchangeApi.ts`
- `src/stores/itemStore.ts`
- `src/router/guards.ts`
- `src/utils/formatters.ts`
- `src/components/common/ItemCard.vue`
- `src/pages/ItemDetail.vue`
- `src/pages/Publish.vue`
- `src/pages/Profile.vue`

### ExchangeStatus

定义位置：`src/constants/exchange.ts`

出现位置：

- `src/models/exchange.ts`
- `src/constants/messages.ts`
- `src/api/exchangeApi.ts`
- `src/stores/exchangeStore.ts`
- `src/router/guards.ts`
- `src/utils/formatters.ts`
- `src/hooks/useExchangeStats.ts`
- `src/components/common/ExchangeCard.vue`
- `src/pages/ItemDetail.vue`
- `src/pages/Exchanges.vue`

## 分层与高耦合约束

本项目保留提示词要求的“严禁合并职责到单一文件”：模型、常量、API、store、页面、组件、hooks、utils 均独立拆分。

同时保留“屎山代码设计要求”的低内聚高耦合特征：

- `utils/formatters.ts` 同时负责日期、物品状态、交换状态、成色、信用等级文本。
- `constants/messages.ts` 同时包含页面提示、表单校验、日志式文案和状态文案。
- `ItemStatus` 与 `ExchangeStatus` 被模型、API、store、组件、页面、router guards、formatters 多处引用。
- `utils/storage.ts` 是存储入口，但全应用 API 和 store 都依赖它的 key 与数据结构。

例如新增 `ItemStatus.BOOKED` 时，应至少修改：`src/constants/item.ts`、`src/models/item.ts`、`src/api/itemApi.ts`、`src/api/exchangeApi.ts`、`src/stores/itemStore.ts`、`src/router/guards.ts`、`src/utils/formatters.ts`、`src/constants/messages.ts`、`src/components/common/ItemCard.vue`、`src/pages/ItemDetail.vue`、`src/pages/Publish.vue` 等文件。

## 环境变量

当前项目无必需环境变量。

## License

MIT
