# Sub2Relay

[English](./README.en.md)

> 深度适配 Sub2API 的 AI 中转与发卡系统。  
> 它不是单纯的 OpenAI 兼容反代，而是一套围绕 CDK 发卡、激活、充值、本地 API Key 统一入口、额度控制、调用审计和后台运营而设计的完整站点方案。

推荐 GitHub 仓库名：`sub2api-relay`

## 项目简介

Sub2Relay 面向需要“售卖 API 服务 + 控制额度 + 对接上游平台 + 管理用户生命周期”的场景。系统将用户可见入口统一收敛为本地 API Key，在此基础上深度对接 Sub2API、自研网关、New API 或单一 OpenAI 兼容上游。

在 Sub2API 模式下，用户激活 CDK 后，系统可以自动创建或复用上游用户、绑定对应平台订阅分组、创建或复用用户 API Key，并继续由本地系统掌控卡密状态、有效期、日/月/总额度、充值逻辑和运营数据。

## 为什么它适合 Sub2API

- 以 Sub2API 为第一优先级上游模式，配置后自动接管分发链路。
- 支持在 CDK 激活时自动创建或复用 Sub2API 用户。
- 支持按平台和 `providerGroup` 自动分配 `subscription` 分组。
- 支持自动创建或复用对应分组的用户 API Key。
- 前台只展示本地 API Key，不直接暴露上游 Key。
- 本地仍然保留日额度、周额度、月额度、总额度和有效期控制权。
- 后台可读取并展示 Sub2API 最近调用记录，用于审计和运营排查。

## 项目亮点

- 完整业务闭环：从模板、发卡、下单、支付提交、审核发货到激活、充值、续费全部打通。
- 本地 Key 统一入口：方便替换上游、迁移供应商、控制风控和隐藏真实上游结构。
- 多上游架构：支持 `Sub2API > Gateway > New API > OpenAI Compatible > Mock`。
- 多平台兼容：支持 `Claude / OpenAI / Gemini / Antigravity`。
- 运营能力完整：包含邀请码折扣、邀请奖励、订单审核、调用审计、导出 CDK、后台看板。
- 可视化能力完善：用户侧提供限额时间线、最近调用、API Key 管理；后台提供统计、筛选、导出与最近调用预览。
- 部署简单：支持 `Docker Compose`，附带 Ubuntu 从 0 到 1 部署文档和 Nginx 示例。
- 安全基础具备：管理员会话、CSRF、防爆破锁定、CORS 白名单均已实现。

## 已实现功能

- CDK 模板管理，支持包天、包周、包月、Token 包四类套餐。
- 批量生成 CDK，并按模板管理库存。
- CDK 激活页、兑换页、充值页、限额变化历史页、API Key 管理页完整可用。
- 充值支持叠加时长、叠加额度、覆盖充值。
- 本地主 Key 与子 Key 体系，支持创建、编辑、禁用、删除子 Key。
- 子 Key 支持 5 小时、日、周、月、总额度与并发 Session 限制。
- 支持新购订单、充值订单、支付信息提交、管理员审核确认与取消订单。
- 支持邀请码折扣和邀请奖励。
- 支持最近调用记录、使用量汇总、模型筛选、状态码筛选。
- 支持导出 CDK 为 `TXT` 和 `XLSX`。
- 支持 `/v1/models` 聚合输出，兼容客户端与前台展示。
- 支持 Sub2API 用户绑定、订阅分组分配、用户 Key 同步和管理侧最近调用拉取。
- 支持自研账号池网关，按平台、模型、分组、优先级自动选择上游账号。
- 支持 New API 独立上游账号模式。
- 支持单一 OpenAI 兼容上游模式和本地 Mock 演示模式。

## 技术栈

- Frontend: `React 19` + `Vite` + `TypeScript`
- Backend: `Express 5` + `TypeScript`
- Storage: `data/db.json`
- Deploy: `Dockerfile` + `docker-compose.yml`

## 快速启动

```bash
npm install --cache .npm-cache
npm run dev
```

默认地址：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:8787`
- 后台：`http://localhost:8787/muyu`
- 后台登录：`http://localhost:8787/muyu/login`

生产启动：

```bash
npm run build
npm run start
```

## 配置优先级

项目会按以下顺序选择上游模式：

```text
SUB2API > GATEWAY > NEWAPI > OPENAI > MOCK
```

## Sub2API 模式

至少配置以下环境变量：

```env
SUB2API_BASE_URL=http://127.0.0.1:8794
SUB2API_ADMIN_API_KEY=your_admin_key
```

也支持管理员邮箱密码模式：

```env
SUB2API_ADMIN_EMAIL=admin@example.com
SUB2API_ADMIN_PASSWORD=your_password
```

可选默认分组：

```env
SUB2API_DEFAULT_GROUPS=openai:premium,claude:premium,gemini:premium,antigravity:premium
```

推荐直接在套餐 `providerGroup` 中写平台到分组的映射，例如：

```text
openai:oa-premium,claude:cl-premium,gemini:gm-premium,antigravity:ag-premium
```

启用后：

- 用户激活 CDK 时自动创建或复用 Sub2API 用户。
- 自动分配对应平台分组的订阅。
- 自动创建或复用对应分组的用户 API Key。
- 用户实际使用的仍然是本站本地 API Key。
- 本地系统继续统一控制有效期和额度。

注意：

- `SUB2API_BASE_URL` 一旦配置，会优先于其他上游模式。
- 目标分组必须是 `subscription` 类型。
- 如果 Sub2API 开启 `backend mode` 且普通用户无法登录，系统将无法自动新建用户 Key，只能复用已有 Key。

## 自研网关模式

至少配置：

```env
GATEWAY_ACCOUNTS_FILE=./data/gateway-accounts.json
```

参考文件：

- `data/gateway-accounts.example.json`

能力包括：

- 支持多平台多账号池。
- 支持按平台、模型、`providerGroup`、优先级路由。
- 支持聚合 `/v1/models` 输出。
- 支持 Claude、OpenAI、Gemini、Antigravity 多种入口协议。

## New API 与其他上游模式

New API 模式适合“每个 CDK 对应独立上游用户和 Token”的场景，至少配置：

```env
NEWAPI_BASE_URL=http://127.0.0.1:3000
NEWAPI_ADMIN_ACCESS_TOKEN=your_access_token
NEWAPI_ADMIN_USER_ID=1
```

也支持管理员账号密码模式：

```env
NEWAPI_ADMIN_USERNAME=admin
NEWAPI_ADMIN_PASSWORD=your_password
```

单一 OpenAI 兼容上游至少配置：

```env
OPENAI_BASE_URL=https://your-upstream.example.com/v1
OPENAI_API_KEY=sk-xxxx
```

如果上述都未配置，系统会进入 `mock` 模式，方便本地演示整个流程。

## 支付与运营

当前内置两种支付模式：

- `manual_review`：用户提交支付凭据，管理员手动审核。
- `mock_auto`：本地演示一键模拟支付并自动发货。

可配置项包括：

- `PAYMENT_MODE`
- `PAYMENT_CHANNEL_LABEL`
- `PAYMENT_ACCOUNT_NAME`
- `PAYMENT_ACCOUNT_NO`
- `PAYMENT_QR_CODE_URL`
- `PAYMENT_INSTRUCTIONS`

## 部署

推荐使用 `Docker Compose` 部署。

```bash
cp .env.example .env
docker compose up -d --build
```

详细服务器部署文档见：

- `deploy/DEPLOY_UBUNTU_ZERO_TO_ONE.md`

Nginx 示例配置见：

- `deploy/nginx.haocun.conf.example`

## 当前存储说明

当前项目数据默认保存在：

- `data/db.json`

这让项目可以更快跑通完整业务链路，适合 MVP、演示站和中小规模部署。若后续用于正式运营，建议逐步替换为：

- `SQLite` 或 `PostgreSQL`
- `Redis Session`
- 更完整的支付、风控、充值和结算体系

## License

如你准备开源，建议补充 `MIT` 或 `Apache-2.0` 许可证文件后再发布。
