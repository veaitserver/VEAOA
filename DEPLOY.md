# 部署到 Railway：测试环境 + 生产环境

两套完全隔离的系统，各有各的数据库、密钥和域名。改动一律先上测试，跑通回归再推生产。

---

## 0. 先决条件：数据库要换成 Postgres

**这一步必须先做，否则生产数据会丢。**

现在 `prisma/schema.prisma` 用的是 SQLite，数据存在容器里的一个文件。Railway 的容器文件系统是**临时的**——每次部署、每次重启、每次崩溃重启，容器都会被换成新的，那个 `.db` 文件跟着一起没了。学生、课包、账本全部归零，且不可恢复。

三条路：

| 方案 | 结论 |
|---|---|
| SQLite + Railway Volume | 能跑。数据挂在持久卷上不会丢，但**没有自动备份**，卷坏了就没了；也只能跑单实例。 |
| **Postgres（推荐）** | Railway 自带托管 Postgres，有自动备份和时间点恢复。 |
| 现状（SQLite 无卷） | **不能用**。上线即丢数据。 |

系统还没有真实数据，现在换成本最低——改个 provider、重新生成一份迁移、重新初始化。等录了几百个学生再换，就得写数据搬迁脚本了。

换库的具体步骤见文末「附录 A」。**下面的所有内容都假设已经换成 Postgres。**

---

## 1. Railway 的结构

一个 project，两个 environment，各自一套服务：

```
VEA EMS (project)
├── staging (environment)
│   ├── web        ← GitHub 仓库，跟踪 main 分支
│   └── Postgres   ← 测试库，数据随便造
└── production (environment)
    ├── web        ← 同一个仓库，跟踪 production 分支
    └── Postgres   ← 生产库，真实数据
```

两个环境的变量、数据库、域名互不相通。测试环境的密钥泄露了，也伪造不了生产的登录会话。

---

## 2. 建测试环境

1. Railway → **New Project** → **Deploy from GitHub repo** → 选 `veaitserver/VEAOA`
2. 项目建好后，把默认环境改名为 `staging`（Settings → Environment）
3. **加数据库**：项目里 **+ New** → **Database** → **PostgreSQL**
4. 点 web 服务 → **Settings**：
   - Branch：`main`
   - Build / Start Command：留空，走仓库里的 `railway.json` 和 `nixpacks.toml`
5. **Variables** 里加（`DATABASE_URL` 用引用变量，别手抄密码）：

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   APP_ENV=staging
   NEXTAUTH_SECRET=<openssl rand -base64 32 生成，测试专用>
   NEXTAUTH_URL=https://<测试域名>
   LEAD_IMPORT_API_KEY=<测试专用，随便一串>
   TRUSTED_PROXY_HOPS=1
   ```

6. **Settings → Networking → Generate Domain**，拿到域名后回填 `NEXTAUTH_URL`，重新部署

7. 灌演示数据（只有测试环境能跑，seed 里有弱口令账号）：

   ```bash
   railway run --environment staging npm run db:seed
   ```

8. 打开域名，用 `6470000001 / sales123` 之类的演示账号登录，能进就成了

---

## 3. 建生产环境

1. Railway 项目里 → **New Environment** → 命名 `production`
2. 同样加一个 **PostgreSQL**（**必须是新的**，绝不能和测试共用一个库）
3. web 服务 → Settings → Branch 改成 `production`
4. **Variables**（注意每一项都要和测试**不同**）：

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   APP_ENV=production
   NEXTAUTH_SECRET=<重新生成一把，绝不能和测试相同>
   NEXTAUTH_URL=https://<生产域名>
   LEAD_IMPORT_API_KEY=<重新生成一把>
   TRUSTED_PROXY_HOPS=1
   ```

5. 建 `production` 分支并首次部署：

   ```bash
   git push origin main:production
   ```

6. **初始化生产库**（只建校区/年级/科目 + 一个超管，不造任何业务数据）：

   ```bash
   railway run --environment production \
     -- BOOTSTRAP_ADMIN_NAME="你的名字" \
        BOOTSTRAP_ADMIN_PHONE="6470001234" \
        BOOTSTRAP_ADMIN_PASSWORD='<至少12位的强口令>' \
        npm run db:bootstrap
   ```

   跑完把这三个变量从 Railway 里删掉。这个脚本可以重复跑，但**不会**重置已存在账号的密码——避免误运行把线上口令冲掉。

7. 用刚建的超管登录，在后台**手工建**校长、财务、HR 等真实账号

> `npm run db:seed` 在 `APP_ENV=production` 时会直接拒绝执行。演示账号的密码（`admin123` 等）写在仓库里，灌进生产等于开着后门。

---

## 4. 日常发布流程

```
本地开发 → 推 main → 测试环境自动部署 → 跑回归 → 通过 → 推 production → 生产自动部署
```

### 4.1 推到测试

```bash
git push origin main
```

Railway 检测到 `main` 变化，自动构建部署。构建做 `prisma generate && next build`，启动做 `prisma migrate deploy && next start`——**迁移在每次启动时自动执行**，不用手动跑。

### 4.2 跑回归（发布闸门）

```bash
PROBE_BASE=https://<测试域名> DATABASE_URL=<测试库的连接串> npm run probe
```

必须 **156/156 全绿**才能往下走。

⚠️ 两个变量必须指向**同一个环境**。`PROBE_BASE` 打测试、`DATABASE_URL` 却连生产，脚本会一边读生产库一边删数据。

⚠️ probe 会真实创建和删除学生、课包、用户。已经加了护栏：远程目标会先读 `/api/health`，自报 `production` 直接拒绝，**问不出环境也拒绝**（fail closed）。但护栏不能替代看清楚自己在敲什么。

⚠️ probe 中途抛异常时，汇总数字仍会打印。看到绿色数字的同时确认**没有 stack trace**——否则那是残缺的一轮。

### 4.3 推到生产

```bash
git push origin main:production
```

这是一次快进合并，把测试上验过的那个 commit 原样推到生产分支。不要在 `production` 分支上直接改代码。

### 4.4 出问题回滚

Railway → production 环境 → web 服务 → **Deployments** → 找到上一个正常版本 → **Redeploy**。

代码能秒回，**数据库迁移回不去**。所以带迁移的改动上生产前，务必在测试上确认迁移能跑通。删列、改类型这类破坏性迁移，上线前先在 Railway 后台给生产库打一个手动备份。

---

## 5. 环境变量对照表

| 变量 | 测试 | 生产 | 说明 |
|---|---|---|---|
| `DATABASE_URL` | 测试库 | 生产库 | 用 `${{Postgres.DATABASE_URL}}` 引用，不要手抄 |
| `APP_ENV` | `staging` | `production` | 决定 seed 能否运行、probe 能否打过来 |
| `NEXTAUTH_SECRET` | 各自一把 | 各自一把 | **绝不能相同** |
| `NEXTAUTH_URL` | 测试域名 | 生产域名 | 含 `https://`，结尾不带斜杠 |
| `LEAD_IMPORT_API_KEY` | 各自一把 | 各自一把 | 测试的 key 不该能往生产灌线索 |
| `TRUSTED_PROXY_HOPS` | `1` | `1` | Railway 在前面挡了一层，限流靠它取真实 IP |
| `TZ` | 已在 `nixpacks.toml` | 同左 | `America/Toronto` |

完整清单见 [.env.example](.env.example)。

---

## 6. 常见问题

**部署成功但打不开 / healthcheck 一直失败**
看 Deploy Logs。多半是 `prisma migrate deploy` 挂了（`DATABASE_URL` 没配对），或者 Postgres 服务还没起来。`/api/health` 在数据库连不上时返回 503，Railway 因此判定不健康——这是故意的，连不上库就不该放流量进来。

**登录后一直跳回登录页**
`NEXTAUTH_URL` 和实际访问的域名不一致。必须完全一致，包括 `https://` 和结尾无斜杠。

**换了自定义域名之后登录失效**
改完域名要同步改 `NEXTAUTH_URL` 并重新部署。

**迁移在生产报错**
先看清楚错在哪一条。SQLite 的历史迁移用的是「建新表→拷数据→删旧表」，那套 SQL 在 Postgres 上跑不了——这正是附录 A 要求重新生成迁移基线的原因。

---

## 附录 A：从 SQLite 切到 Postgres

在**还没有真实数据**的时候做，全程约半小时。

1. 改 `prisma/schema.prisma`：

   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```

2. 归档旧迁移（SQLite 专用 SQL 在 Postgres 上跑不通，必须重开基线）：

   ```bash
   git mv prisma/migrations prisma/migrations-sqlite-archive
   mkdir prisma/migrations
   ```

3. 起一个本地 Postgres（Docker），或直接用 Railway 测试库的连接串

4. 生成全新的初始迁移：

   ```bash
   npx prisma migrate dev --name init
   ```

5. 本地验证：

   ```bash
   npm run db:seed
   npm run dev
   npm run probe      # 期望 156/156
   ```

6. 全绿后提交，推 `main`，测试环境会自动带着新迁移部署

**需要复核的点**：SQLite 把 `Float`/`DateTime` 存得比较松，Postgres 是强类型。金额字段现在是 `Float`——生产环境更稳妥的做法是改成 `Decimal(10,2)`，避免浮点误差在账本上累积。切库是顺手改掉它的最佳时机；但这会牵动 `lib/money.ts` 和账本相关代码，属于一次独立的改动。
