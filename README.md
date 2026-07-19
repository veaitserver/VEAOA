# VEA 教务管理系统（VEA EMS）

面向安大略（GTA）教育机构的多校区教务管理系统：学生/线索、课包审批、排课、
课时核销、销售/工时报表，按角色与校区隔离；含面向家长的公开官网与线索捕获。

技术栈：Next.js 16（App Router）· React 19 · Prisma（SQLite）· NextAuth v5 · Tailwind v4。

## 本地启动

```bash
npm install
npx prisma migrate deploy   # 建库 + 应用迁移
npx prisma db seed          # 灌入测试数据（校区/账号/课包/活动）
npm run dev                 # http://localhost:3000
```

`.env`（本地开发，勿提交）：

```
DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="<随机串>"
NEXTAUTH_URL="http://localhost:3000"
LEAD_IMPORT_API_KEY="<线索导入 API key>"   # 见下方「线索捕获」
```

测试账号（seed 输出里有全量 13 个）：超管 `6470000000 / admin123`，
Markham 校长 `6470000003 / principal123`，Markham 销售 `6470000001 / sales123`。

## 线索捕获（Lead Capture）

线上/线下营销线索自动进入系统的「线索学生」，无需手工录入。业务流不变：
线索学生仍只能通过**建课包**转为在读学生。

三个入口共用同一套导入核心（`lib/leadImport.ts`）：
**规范化 → 去重（电话 OR 联系App账号）→ 建档或合并 → 校区内轮询分配 →
次日回访跟进 → 导入日志**。去重命中已有线索时不新建，而是追加一条
「Re-engaged via…」跟进、把回访日期设为次日，并把 `LOST` 状态拉回 `CONTACTED`。

三个入口：

| 入口 | 路径 | 鉴权 | 校区来源 |
|------|------|------|----------|
| API（Google Forms 用） | `POST /api/leads/import` | `x-api-key` 头 = `LEAD_IMPORT_API_KEY` | `campaign_token`，或 payload 显式 `campus` |
| 公开表单 | `GET /join/{token}` ➜ `POST /api/leads/public` | 无（蜜罐 + 按 IP 限流） | 活动（campaign） |
| CSV 批量 | `/admin/leads/import` ➜ `POST /api/leads/import-csv` | 登录（校长/超管） | 导入校长的校区（多校区时弹选） |

### 营销活动（Campaign）

校长在 `/admin/campaigns` 建活动（名称、来源大类/明细、校区、可选默认负责人），
系统生成唯一 token 与公开链接 `/join/{token}` 及二维码（打印在海报/传单上）。
活动详情页含报表：捕获数、转化到在读的转化率、按状态与按**邮编 FSA**（加拿大
营销区域）拆分。

### API payload（snake_case）

```json
{
  "student_name": "张三", "phone": "+1 647-000-0000",
  "preferred_contact_app": "WECHAT", "contact_app_id": "zhangsan_01",
  "grade": "Grade 9", "subjects_of_interest": "数学, 物理",
  "postal_code": "L3T 7P9",
  "campaign_token": "mkm-expo-2026"
}
```

必填 `student_name`、`phone`。带 `campaign_token` 时校区与来源随活动；否则需
`source_category`（`OFFLINE_EVENT`/`ONLINE_CHANNEL`/`REFERRAL`/`OTHER`）、
`source_detail` 与显式 `campus`（校区 id）。返回 `CREATED`(201)/`MERGED`(200)/
`REJECTED`(422)。

### Google Forms 接入

见 [`integrations/google-form-webhook.gs`](integrations/google-form-webhook.gs)：
粘贴到 Form 关联 Sheet 的 Apps Script，配置 `API_URL`/`API_KEY` 与问题映射，
挂「表单提交时」触发器；每次提交 POST 到导入端点，并把 `CREATED/MERGED/ERROR`
写回 Sheet 的「导入状态」列。来源归属用 Google Forms **预填链接**携带
`campaign_token`（脚本注释里有生成步骤），家长不可见、不填。

### CSV 列

首行表头：`student_name, phone, preferred_contact_app, contact_app_id, grade,
subjects_of_interest, source_category, source_detail, postal_code, campaign_token`。
校区由导入校长选定（不在 CSV 里）。

## 回归探测

`scripts/probe.mjs` 是安全与业务的回归套件（需先 `npm run dev`）：

```bash
node scripts/probe.mjs
```

覆盖鉴权/越权、校区隔离、课时账务、并发核销、以及线索导入（去重/合并/分配/
反垃圾）等 38 条断言，夹具自建自清，攻击面走真实 HTTP。
