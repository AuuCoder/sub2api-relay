# HAOCUN 中转站从 0 到 1 部署到 Ubuntu 服务器

这份文档按最常见的场景来写：

- 服务器系统：`Ubuntu 22.04 / 24.04`
- 部署方式：`Docker Compose`
- 反向代理：`Nginx`
- 可选：`Certbot` 申请 HTTPS

如果你只是想先跑起来，不绑域名，也可以直接走“只开端口 8787”的方式。

## 一、准备服务器

建议最低配置：

- `2 核 CPU`
- `2 GB 内存`
- `20 GB 磁盘`

准备好这些信息：

- 服务器公网 IP
- SSH 登录账号
- 可选：一个已解析到服务器 IP 的域名

## 二、登录服务器

在你的本地电脑执行：

```bash
ssh root@你的服务器IP
```

如果你不是 `root`，后面的命令前面加 `sudo`。

## 三、安装 Docker、Compose、Nginx、Certbot

先更新系统：

```bash
apt update
apt upgrade -y
```

安装依赖：

```bash
apt install -y docker.io docker-compose-plugin nginx certbot python3-certbot-nginx
```

启动并设置开机自启：

```bash
systemctl enable --now docker
systemctl enable --now nginx
```

检查版本：

```bash
docker --version
docker compose version
nginx -v
```

## 四、开放防火墙

如果你启用了 `ufw`：

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8787/tcp
ufw enable
ufw status
```

说明：

- 如果你只打算走域名 + Nginx，可以后面再关闭 `8787` 对公网开放
- 如果你只是先用 IP 测试，那就先保留 `8787`

## 五、上传项目到服务器

推荐目录：

```bash
mkdir -p /opt/haocun-relay
```

### 方式 A：你本地直接上传整个项目

在你的本地电脑执行：

```bash
scp -r /Users/chole/项目/中转/* root@你的服务器IP:/opt/haocun-relay/
```

如果你要把隐藏文件一起带上，建议改成：

```bash
rsync -av --exclude node_modules --exclude dist /Users/chole/项目/中转/ root@你的服务器IP:/opt/haocun-relay/
```

说明：

- 不需要上传 `node_modules`
- 不需要依赖本地已经构建好的 `dist`
- 服务器会自己构建

### 方式 B：服务器自己拉代码

如果你已经把项目放到 Git 仓库：

```bash
cd /opt
git clone 你的仓库地址 haocun-relay
cd /opt/haocun-relay
```

## 六、选择数据方案

当前项目数据保存在：

- `data/db.json`

你有两种方式。

### 方案 1：保留你当前本地站点数据

适合你想把现在的：

- 模板
- CDK
- 后台设置
- 使用记录

一起迁移到服务器。

做法：

- 保留并上传当前的 `data/db.json`

### 方案 2：服务器全新开站

适合你想重新开始，不带本地测试数据。

在服务器执行：

```bash
cd /opt/haocun-relay
rm -f data/db.json
```

首次启动时系统会自动生成新的站点数据。

## 七、创建服务器环境变量

进入项目目录：

```bash
cd /opt/haocun-relay
cp .env.example .env
```

编辑：

```bash
nano .env
```

至少改这些。

### 1. 基础配置

```env
PORT=8787
PUBLIC_BASE_URL=https://你的域名
CORS_ALLOWED_ORIGINS=https://你的域名
```

如果你暂时还没有域名，只想先通过 IP 测试：

```env
PORT=8787
PUBLIC_BASE_URL=http://你的服务器IP:8787
CORS_ALLOWED_ORIGINS=http://你的服务器IP:8787
```

### 2. 后台配置

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=改成你自己的复杂密码
```

注意：

- 如果你保留了旧的 `data/db.json`，管理员账号密码以库里的现有数据为准
- 想强制使用新的管理员账号密码，可以删除 `data/db.json` 后再启动

### 3. 支付配置

如果你现在只是先把站跑起来，先保留默认即可。

```env
PAYMENT_MODE=manual_review
PAYMENT_CHANNEL_LABEL=支付宝 / 微信人工审核
```

### 4. 上游配置

这个项目有几种模式，优先级是：

- `SUB2API`
- `GATEWAY`
- `NEWAPI`
- `OPENAI`

你只需要选一种主要模式。

#### 方案 A：Sub2API

如果你要继续对接自己的 Sub2API：

```env
SUB2API_BASE_URL=http://你的sub2api地址
SUB2API_ADMIN_API_KEY=你的管理员APIKey
SUB2API_DEFAULT_GROUPS=openai:premium,claude:premium,gemini:premium,antigravity:premium
```

如果你只有一个统一分组，也可以写：

```env
SUB2API_DEFAULT_GROUPS=premium
```

#### 方案 B：自研网关账号池

如果你不想用 Sub2API，而是直接配置平台账号池：

```env
GATEWAY_ACCOUNTS_FILE=./data/gateway-accounts.json
```

然后执行：

```bash
cp data/gateway-accounts.example.json data/gateway-accounts.json
nano data/gateway-accounts.json
```

把里面的账号、模型、分组改成你自己的。

#### 方案 C：New API

```env
NEWAPI_BASE_URL=http://你的newapi地址
NEWAPI_ADMIN_ACCESS_TOKEN=你的管理token
NEWAPI_ADMIN_USER_ID=你的管理员用户ID
NEWAPI_USER_GROUP=default
NEWAPI_TOKEN_GROUP=
```

#### 方案 D：单一 OpenAI 兼容上游

```env
OPENAI_BASE_URL=https://你的上游地址/v1
OPENAI_API_KEY=你的上游Key
```

## 八、启动项目

第一次启动：

```bash
cd /opt/haocun-relay
docker compose up -d --build
```

查看运行状态：

```bash
docker compose ps
docker compose logs -f
```

健康检查：

```bash
curl http://127.0.0.1:8787/api/public/catalog
```

如果返回 JSON，就说明服务起来了。

## 九、先用 IP 测试

如果你还没配域名，先直接访问：

- `http://你的服务器IP:8787`
- 后台：`http://你的服务器IP:8787/muyu`

确认这些页面正常：

- 首页
- CDK 页面
- 后台登录页
- 后台管理页

## 十、配置域名反向代理

如果你已经有域名，并且域名已经解析到服务器公网 IP：

先复制 Nginx 示例配置：

```bash
cp deploy/nginx.haocun.conf.example /etc/nginx/sites-available/haocun-relay.conf
```

编辑配置：

```bash
nano /etc/nginx/sites-available/haocun-relay.conf
```

把里面的：

```nginx
server_name relay.example.com;
```

改成你的域名，例如：

```nginx
server_name api.yourdomain.com;
```

启用站点：

```bash
ln -sf /etc/nginx/sites-available/haocun-relay.conf /etc/nginx/sites-enabled/haocun-relay.conf
nginx -t
systemctl reload nginx
```

这时你应该能通过：

- `http://你的域名`

访问到项目。

## 十一、申请 HTTPS

执行：

```bash
certbot --nginx -d 你的域名
```

例如：

```bash
certbot --nginx -d api.yourdomain.com
```

成功后：

- Nginx 会自动写入 HTTPS 配置
- 证书会自动续期

测试自动续期：

```bash
certbot renew --dry-run
```

## 十二、改回正式域名环境变量

如果你最开始用的是 IP，等域名和 HTTPS 都通了之后，记得把 `.env` 里的这两项改成正式地址：

```env
PUBLIC_BASE_URL=https://你的域名
CORS_ALLOWED_ORIGINS=https://你的域名
```

改完重启：

```bash
cd /opt/haocun-relay
docker compose up -d --build
```

## 十三、后台登录

后台地址：

- `https://你的域名/muyu`

如果你保留的是当前项目数据，那么后台密码以现有数据为准。

如果你是全新开站，后台密码就是 `.env` 里的：

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

## 十四、常用运维命令

查看日志：

```bash
cd /opt/haocun-relay
docker compose logs -f
```

重启服务：

```bash
docker compose restart
```

停止服务：

```bash
docker compose down
```

更新后重建：

```bash
docker compose up -d --build
```

查看容器状态：

```bash
docker compose ps
```

## 十五、备份数据

最重要的数据目录是：

- `/opt/haocun-relay/data`

至少备份：

- `data/db.json`
- `data/gateway-accounts.json`（如果你使用自研网关）
- `.env`

可以直接打包：

```bash
cd /opt
tar czvf haocun-relay-backup-$(date +%F).tar.gz haocun-relay/data haocun-relay/.env
```

## 十六、推荐上线后的收尾

建议你上线后马上做这几件事：

1. 把后台密码改成强密码。
2. 给域名配 HTTPS，不要长期裸跑 HTTP。
3. 把 `PUBLIC_BASE_URL` 和 `CORS_ALLOWED_ORIGINS` 改成正式域名。
4. 备份 `data/db.json`。
5. 如果是正式运营，尽量不要继续保留测试 CDK 和测试套餐。

## 十七、最短路径版

如果你只想最快跑起来，最少命令如下：

```bash
apt update
apt install -y docker.io docker-compose-plugin
mkdir -p /opt/haocun-relay
cd /opt/haocun-relay
```

把项目上传进去后：

```bash
cp .env.example .env
nano .env
docker compose up -d --build
docker compose ps
```

然后直接访问：

- `http://你的服务器IP:8787`
- `http://你的服务器IP:8787/muyu`

如果你愿意，下一步可以直接按你的服务器信息继续做一版：

- 你的域名版 `.env`
- 你的 Nginx 配置
- 你的启动命令清单

你只要把服务器 IP、域名、以及你准备使用的上游模式告诉我，我可以继续给你生成“可直接复制执行”的最终版本。
