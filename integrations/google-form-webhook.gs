/**
 * VEA 线索捕获 —— Google Form ➜ 导入端点 桥接脚本
 * =====================================================================
 *
 * 数据流：Google Form → 关联的 Google Sheet → onFormSubmit 触发器 →
 *         POST 到 /api/leads/import → 把结果写回 Sheet 的「导入状态」列。
 *
 * ── 一次性安装 ────────────────────────────────────────────────────────
 * 1. 打开 Form 关联的 Google Sheet（表单「回复」→ 绿色 Sheets 图标）。
 * 2. 扩展程序 → Apps Script，把本文件内容整个粘贴进去。
 * 3. 填好下面 CONFIG 里的 API_URL 与 API_KEY。
 * 4. 在回复表的最后新增一列，表头写「导入状态」（STATUS_HEADER，可改）。
 * 5. 左侧「触发器」→ 添加触发器：
 *      函数 onFormSubmit / 事件来源「来自表单」/ 事件类型「表单提交时」。
 * 6. 首次运行会要求授权，允许即可。
 *
 * ── 表单问题 → 字段映射 ───────────────────────────────────────────────
 * 把表单的问题标题设成 QUESTION_MAP 的键（或反过来改 QUESTION_MAP 去对上
 * 你已有的问题标题）。必填：家长姓名、电话。
 *
 * ── 来源归属：用「预填链接」而不是让员工手填 ─────────────────────────
 * 每个活动/渠道用各自的预填 URL，把来源信息带进去，家长看不到也不用填。
 * 两种做法，二选一：
 *
 *  A) 【推荐】用 campaign_token（后台先在「营销活动」建活动，拿到 token）
 *     - 在表单加一个简答题，标题「campaign_token」。
 *     - 生成预填链接：表单右上「⋮」→「获取预先填写的链接」→ 只在
 *       campaign_token 那题填入活动 token（如 mkm-expo-2026）→「获取链接」→ 复制。
 *     - 该链接生成的二维码/短链印在该活动的海报上。校区与来源都随活动，
 *       无需再填 source_category/source_detail。
 *
 *  B) 直接带 source_category + source_detail（无 campaign 时）
 *     - 表单加两个简答题：「source_category」「source_detail」。
 *     - 同样用「获取预先填写的链接」，分别填入：
 *         source_category = OFFLINE_EVENT | ONLINE_CHANNEL | REFERRAL | OTHER
 *         source_detail   = 自由文本，如「Markham Math Expo 2026」
 *     - 注意：此法下 payload 无 campaign_token，导入端点要求 payload 带显式
 *       campus（校区 id）。可再加一个「campus」简答题并在预填链接里填入校区 id。
 *       （多数情况建议用 A，让活动携带校区，最省事。）
 *
 * 预填链接形如：
 *   https://docs.google.com/forms/d/e/XXXX/viewform?usp=pp_url&entry.123456=mkm-expo-2026
 * 把这些「来源」问题在表单里放到最后、说明写「请勿修改」，家长正常不会动它们。
 * =====================================================================
 */

// ── CONFIG（改这里）─────────────────────────────────────────────────────
var CONFIG = {
  API_URL: "https://your-app.up.railway.app/api/leads/import", // ← 换成实际部署地址
  API_KEY: "PASTE_LEAD_IMPORT_API_KEY_HERE",                    // ← 与服务端 .env 的 LEAD_IMPORT_API_KEY 一致
  STATUS_HEADER: "导入状态",                                     // 回复表里用于写回结果的列表头
};

// 表单问题标题 → API payload 字段（snake_case）。左边按你的表单实际问题标题改。
var QUESTION_MAP = {
  "家长姓名": "parent_name",
  "手机号": "phone",
  "联系方式": "preferred_contact_app",   // 值建议：PHONE / WECHAT / XIAOHONGSHU / WHATSAPP / OTHER
  "微信号/账号": "contact_app_id",
  "年级": "grade",
  "意向科目": "subjects_of_interest",
  "邮编": "postal_code",
  // 来源相关（走预填，家长不填）：
  "campaign_token": "campaign_token",
  "source_category": "source_category",
  "source_detail": "source_detail",
  "campus": "campus",
};

/**
 * 表单提交触发器。e.namedValues = { 问题标题: [答案, ...] }。
 */
function onFormSubmit(e) {
  var payload = {};
  var named = e.namedValues || {};
  for (var title in QUESTION_MAP) {
    if (named[title] && named[title].length) {
      var val = String(named[title][0]).trim();
      if (val !== "") payload[QUESTION_MAP[title]] = val;
    }
  }

  var status;
  try {
    var res = UrlFetchApp.fetch(CONFIG.API_URL, {
      method: "post",
      contentType: "application/json",
      headers: { "x-api-key": CONFIG.API_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true, // 自己读状态码，不让非 2xx 抛异常
    });
    var code = res.getResponseCode();
    var bodyText = res.getContentText();
    var body = {};
    try { body = JSON.parse(bodyText); } catch (ignore) {}

    if (code === 201) status = "CREATED";
    else if (code === 200) status = (body.result || "OK");
    else status = "ERROR " + code + ": " + (body.error || bodyText).slice(0, 200);
  } catch (err) {
    status = "ERROR: " + err;
  }

  writeStatus(e, status);
}

/**
 * 把结果写回本次提交那一行的「导入状态」列。
 * 若找不到该列，则写到当前行最后一列的右边一格。
 */
function writeStatus(e, status) {
  try {
    var range = e.range;                 // 本次提交所在行
    if (!range) return;
    var sheet = range.getSheet();
    var row = range.getRow();
    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    var col = headers.indexOf(CONFIG.STATUS_HEADER) + 1; // 1-based，0 表示没找到
    if (col === 0) {
      col = lastCol + 1;
      sheet.getRange(1, col).setValue(CONFIG.STATUS_HEADER);
    }
    sheet.getRange(row, col).setValue(status + "  @" + new Date().toISOString());
  } catch (err) {
    // 写回失败不影响导入本身，Apps Script 执行日志里可查
    console.error("writeStatus failed: " + err);
  }
}
