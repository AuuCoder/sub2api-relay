# Sub2Relay

[简体中文](./README.md)

> A Sub2API-first AI relay and CDK distribution system.  
> Sub2Relay is more than an OpenAI-compatible reverse proxy. It combines CDK issuing, activation, recharge, local API key distribution, quota control, usage audit, and an admin console into one operable full-stack project.

Recommended GitHub repository name: `sub2api-relay`

## Overview

Sub2Relay is built for teams that need to sell API access, control quotas, connect to upstream providers, and manage user lifecycles in one place. The project keeps the user-facing entry unified as local API keys while deeply integrating with Sub2API, a self-hosted gateway pool, New API, or a single OpenAI-compatible upstream.

In Sub2API mode, once a CDK is activated, the system can automatically create or reuse an upstream user, bind platform-specific subscription groups, create or reuse user API keys, and still keep quota rules, expiration, recharge logic, and operational data under local control.

## Why It Fits Sub2API So Well

- Sub2API is the first-priority upstream mode and takes over the distribution flow once configured.
- It can automatically create or reuse Sub2API users during CDK activation.
- It can map `providerGroup` values to platform-specific `subscription` groups.
- It can automatically create or reuse user API keys for the matched group.
- The frontend only exposes local API keys and never directly shows upstream keys.
- Daily, weekly, monthly, total quotas, and expiration are still enforced locally.
- The admin side can pull recent Sub2API usage logs for audit and operations.

## Highlights

- Complete business flow from templates, CDK issuing, orders, payment submission, approval, activation, recharge, and renewal.
- Local API keys as the single entry point, which makes upstream replacement, vendor migration, and risk control easier.
- Multi-upstream architecture with `Sub2API > Gateway > New API > OpenAI Compatible > Mock`.
- Multi-platform support for `Claude / OpenAI / Gemini / Antigravity`.
- Operational tooling built in, including invite discounts, invite rewards, order review, usage audit, CDK export, and admin dashboard.
- Visualized user and admin experience, including quota timelines, recent usage, API key management, filtering, and export.
- Simple deployment with `Docker Compose`, plus an Ubuntu deployment guide and Nginx example config.
- Solid baseline security with admin sessions, CSRF protection, brute-force lockout, and CORS allowlists.

## Implemented Features

- CDK template management with daily, weekly, monthly, and token-pack style plans.
- Batch CDK generation with per-template inventory management.
- Fully usable activation, redemption, recharge, quota history, and API key management pages.
- Recharge modes for extending duration, boosting quota, or overwriting quota.
- Primary key plus child key model with create, edit, disable, and delete actions.
- Child key limits for 5-hour, daily, weekly, monthly, total quotas, and concurrent sessions.
- New purchase orders, recharge orders, payment submission, admin confirmation, and cancellation flow.
- Invite-code discounts and referral rewards.
- Recent usage, usage summaries, model filtering, and status-code filtering.
- Aggregated `/v1/models` output for client compatibility and frontend display.
- Sub2API user binding, subscription assignment, user key sync, and admin recent-usage fetching.
- Self-hosted account pool gateway with routing by platform, model, group, and priority.
- New API mode for per-CDK upstream user and token provisioning.
- Single OpenAI-compatible upstream mode and local mock mode for demos.

## Tech Stack

- Frontend: `React 19` + `Vite` + `TypeScript`
- Backend: `Express 5` + `TypeScript`
- Storage: `data/db.json`
- Deployment: `Dockerfile` + `docker-compose.yml`

## Quick Start

```bash
npm install --cache .npm-cache
npm run dev
```

Default addresses:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8787`
- Admin: `http://localhost:8787/muyu`
- Admin login: `http://localhost:8787/muyu/login`

Production start:

```bash
npm run build
npm run start
```

## Upstream Priority

The project selects upstream modes in the following order:

```text
SUB2API > GATEWAY > NEWAPI > OPENAI > MOCK
```

## Sub2API Mode

At minimum, configure:

```env
SUB2API_BASE_URL=http://127.0.0.1:8794
SUB2API_ADMIN_API_KEY=your_admin_key
```

Admin email and password mode is also supported:

```env
SUB2API_ADMIN_EMAIL=admin@example.com
SUB2API_ADMIN_PASSWORD=your_password
```

Optional default group mapping:

```env
SUB2API_DEFAULT_GROUPS=openai:premium,claude:premium,gemini:premium,antigravity:premium
```

It is recommended to define platform-to-group mapping directly in each template's `providerGroup`, for example:

```text
openai:oa-premium,claude:cl-premium,gemini:gm-premium,antigravity:ag-premium
```

With this mode enabled:

- CDK activation automatically creates or reuses a Sub2API user.
- The matching subscription group is assigned automatically.
- A user API key for the matching group is created or reused automatically.
- End users still use your local API key instead of the upstream key.
- Expiration and quota rules remain controlled by the local system.

Notes:

- Once `SUB2API_BASE_URL` is configured, it takes priority over all other upstream modes.
- The target group must be of type `subscription`.
- If Sub2API runs in `backend mode` and regular users cannot log in, the system can only reuse existing user keys instead of creating new ones.

## Self-Hosted Gateway Mode

At minimum, configure:

```env
GATEWAY_ACCOUNTS_FILE=./data/gateway-accounts.json
```

Reference file:

- `data/gateway-accounts.example.json`

This mode supports:

- Multiple platforms with multiple upstream account pools.
- Routing by platform, model, `providerGroup`, and priority.
- Aggregated `/v1/models` output.
- Protocol handling for Claude, OpenAI, Gemini, and Antigravity.

## New API and Other Upstream Modes

New API mode fits the scenario where each CDK should receive an independent upstream user and token. At minimum, configure:

```env
NEWAPI_BASE_URL=http://127.0.0.1:3000
NEWAPI_ADMIN_ACCESS_TOKEN=your_access_token
NEWAPI_ADMIN_USER_ID=1
```

Admin username and password mode is also supported:

```env
NEWAPI_ADMIN_USERNAME=admin
NEWAPI_ADMIN_PASSWORD=your_password
```

For a single OpenAI-compatible upstream, configure at minimum:

```env
OPENAI_BASE_URL=https://your-upstream.example.com/v1
OPENAI_API_KEY=sk-xxxx
```

If none of the upstream modes are configured, the project falls back to `mock` mode for local demos.

## Payments and Operations

Two payment modes are currently built in:

- `manual_review`: users submit payment proof and admins approve manually.
- `mock_auto`: one-click mock payment with automatic fulfillment for local demos.

Available payment-related settings:

- `PAYMENT_MODE`
- `PAYMENT_CHANNEL_LABEL`
- `PAYMENT_ACCOUNT_NAME`
- `PAYMENT_ACCOUNT_NO`
- `PAYMENT_QR_CODE_URL`
- `PAYMENT_INSTRUCTIONS`

## Deployment

`Docker Compose` is the recommended deployment method.

```bash
cp .env.example .env
docker compose up -d --build
```

Detailed server deployment guide:

- `deploy/DEPLOY_UBUNTU_ZERO_TO_ONE.md`

Nginx example config:

- `deploy/nginx.haocun.conf.example`

## Storage Notes

Project data is currently stored in:

- `data/db.json`

This keeps the project lightweight and fast to bootstrap, which is great for MVPs, demo stations, and small to medium deployments. For production-grade operations, it is recommended to gradually replace it with:

- `SQLite` or `PostgreSQL`
- `Redis` for sessions
- A more complete payment, risk-control, recharge, and settlement stack

## License

If you plan to open source this project, add an `MIT` or `Apache-2.0` license file before publishing.
