"use strict";
const M = require("./management"),
  R = require("./rules"),
  { need } = R;
function setup(s) {
  s.db
    .exec(`CREATE TABLE IF NOT EXISTS account_activity(owner TEXT,day TEXT,last TEXT,PRIMARY KEY(owner,day));
CREATE TABLE IF NOT EXISTS ticket_history(id TEXT PRIMARY KEY,ticket INTEGER,at TEXT,actor TEXT,action TEXT,reason TEXT);
CREATE TABLE IF NOT EXISTS plan_inputs(owner TEXT,start TEXT,value TEXT,at TEXT,PRIMARY KEY(owner,start));`);
}
function enrich(s, p, d) {
  if (d.users) {
    d.activity = s
      .all("SELECT * FROM account_activity")
      .filter((x) => M.inScope(s, p, x.owner))
      .map((x) => ({ user: M.user(s, x.owner).id, day: x.day, last: x.last }));
    for (const u of d.users) {
      const owner = s.get("SELECT owner FROM user_meta WHERE id=?", u.id).owner,
        ev = s.all(
          "SELECT at,action,before_value,after_value FROM business_events WHERE owner=? ORDER BY at",
          owner,
        );
      u.plans = u.plans.map((plan) => {
        const changes = ev.filter((e) => {
          const a = M.parse(e.before_value),
            b = M.parse(e.after_value);
          return (
            JSON.stringify(a.weeks?.[plan.start]) !==
              JSON.stringify(b.weeks?.[plan.start]) ||
            Object.values({ ...a.sessions, ...b.sessions }).some(
              (x) =>
                x.date >= plan.start &&
                x.date <= R.shift(plan.start, 6) &&
                JSON.stringify(a.sessions?.[x.date]) !==
                  JSON.stringify(b.sessions?.[x.date]),
            )
          );
        });
        return {
          ...plan,
          created: changes[0]?.at || null,
          at: changes.at(-1)?.at || null,
          revision: changes.length || null,
          source: plan.days > 4 ? "用户自建" : "规则生成",
          status:
            R.shift(plan.start, 6) < require("./ledger").dayKey(new Date())
              ? "已归档"
              : "已保存",
          modified: changes.length > 1 ? "已修改" : "未修改",
          input: M.parse(
            s.get(
              "SELECT value FROM plan_inputs WHERE owner=? AND start=?",
              owner,
              plan.start,
            )?.value,
            null,
          ),
        };
      });
      const account = s.account(owner);
      u.meals = Object.fromEntries(
        Object.entries(u.meals).map(([key, m]) => [
          key,
          {
            ...m,
            dayTarget: account.meals[key].profileSnapshot?.targets || null,
            ratios: account.meals[key].profileSnapshot?.ratios || null,
          },
        ]),
      );
    }
  }
  if (d.dictionaries || d.users)
    d.equipment =
      require("../微信小程序/miniprogram/data/catalog").equipmentCatalog;
  return d;
}
function endpoint(s, actor, action, b, req) {
  const p = M.principal(s, actor),
    reason = () =>
      need(typeof b.reason === "string" && b.reason.trim(), "请填写处理原因");
  if (action === "ticket") {
    M.allow(p, "users.manage");
    reason();
    const t = s.get("SELECT * FROM tickets WHERE id=?", b.id);
    need(t && t.owner && M.inScope(s, p, t.owner), "无此工单权限", 403);
    need(t.status !== "已处理", "工单已处理", 409);
    if (b.operation === "注销") {
      need(
        t.kind === "注销" && b.confirm === String(t.id),
        "请输入工单编号确认注销",
      );
      s.run("DELETE FROM sessions WHERE owner=?", t.owner);
      s.run("DELETE FROM requests WHERE owner=?", t.owner);
      s.run("DELETE FROM accounts WHERE id=?", t.owner);
      s.run("DELETE FROM user_avatars WHERE owner=?", t.owner);
      s.run("DELETE FROM business_events WHERE owner=?", t.owner);
      s.run("DELETE FROM favorite_events WHERE owner=?", t.owner);
      s.run("DELETE FROM account_activity WHERE owner=?", t.owner);
      s.run("DELETE FROM plan_inputs WHERE owner=?", t.owner);
      // Keep accounting identifiers; erase personal prompt/output material for this account.
      s.run(
        "UPDATE model_payloads SET request='null',response='null',validation='账号已注销，内容已清理' WHERE call_id IN (SELECT id FROM model_calls WHERE owner=?)",
        t.owner,
      );
      s.run(
        "UPDATE generations SET input='null',output='null' WHERE owner=?",
        t.owner,
      );
      s.run(
        "UPDATE tickets SET owner='',detail='',consent=0,status='已处理' WHERE owner=?",
        t.owner,
      );
      s.run(
        "UPDATE user_meta SET status='已注销',note='' WHERE owner=?",
        t.owner,
      );
    } else {
      need(
        !(t.kind === "注销" && b.operation === "处理"),
        "注销申请必须使用确认注销流程",
      );
      need(["处理", "驳回", "分派"].includes(b.operation), "工单操作无效");
      if (b.operation === "分派") {
        need(
          s.get(
            "SELECT 1 FROM operators o JOIN operator_meta m ON m.name=o.name WHERE o.name=? AND m.enabled=1",
            b.assignee,
          ),
          "接收管理员不存在",
        );
        s.run("UPDATE tickets SET assignee=? WHERE id=?", b.assignee, t.id);
      } else
        s.run(
          "UPDATE tickets SET status=? WHERE id=?",
          b.operation === "驳回" ? "已驳回" : "已处理",
          t.id,
        );
    }
    s.run(
      "INSERT INTO ticket_history VALUES(?,?,?,?,?,?)",
      M.id("T"),
      t.id,
      M.now(),
      actor,
      b.operation,
      b.reason,
    );
    M.audit(
      s,
      actor,
      "工单" + b.operation,
      t.id,
      "成功",
      b.reason,
      { status: t.status },
      { operation: b.operation },
      req,
    );
    return {};
  }
  if (action === "meal-preview" || action === "meal-options") {
    M.allow(p, "users.view");
    const u = s.get("SELECT * FROM user_meta WHERE id=?", b.user);
    need(u && M.inScope(s, p, u.owner), "无此用户权限", 403);
    const m = s.account(u.owner).meals[b.key];
    need(m, "餐次记录不存在", 404);
    const profile = m.profileSnapshot;
    need(profile, "旧记录缺少当时目标快照，无法按原条件复算");
    const foods = M.parse(
        s.get(
          "SELECT value FROM versions WHERE module='foods' AND version=?",
          m.foodsVersion,
        )?.value,
        null,
      ),
      c = s.content();
    need(foods, "原食材版本已清理", 404);
    if (action === "meal-options")
      return foods
        .filter((f) => R.usable(f, profile, c.risk))
        .map((f) => ({ id: f.id, name: f.name, state: f.state }));
    const result = R.meal(profile, m.index, b.items, foods, c.risk);
    M.audit(
      s,
      actor,
      "复算餐次",
      b.key,
      "成功",
      "不写回用户记录",
      null,
      { foodsVersion: m.foodsVersion },
      req,
    );
    return result;
  }
  if (action === "move-batch") {
    M.allow(p, "content.edit");
    reason();
    need(
      Array.isArray(b.ids) && b.ids.length && b.ids.length <= 100,
      "每批选择1–100条",
    );
    need(["分类", "标签", "排课资格"].includes(b.kind), "批量类型无效");
    const results = [];
    for (const id of b.ids) {
      s.db.exec("SAVEPOINT edit_item");
      try {
        const m = M.catalog(s, s.content()).find((m) => m.id === id);
        need(m, "动作不存在", 404);
        const value = { ...(m.draft || m) };
        if (b.kind === "分类") {
          need(b.part && b.muscle, "请填写部位与肌群");
          value.part = b.part;
          value.muscle = b.muscle;
        } else if (b.kind === "标签") {
          need(
            Array.isArray(b.tags) &&
              b.tags.every((t) => typeof t === "string" && t.length < 50),
            "标签无效",
          );
          value.tags = b.tags;
        } else value.enabled = !!b.enabled;
        M.endpoint(s, actor, "move-draft", { id, base: m.version, value }, req);
        s.db.exec("RELEASE edit_item");
        results.push({ id, ok: true });
      } catch (e) {
        s.db.exec("ROLLBACK TO edit_item; RELEASE edit_item");
        results.push({ id, ok: false, error: e.message });
      }
    }
    M.audit(
      s,
      actor,
      "批量" + b.kind,
      "动作草稿",
      results.every((x) => x.ok) ? "成功" : "部分成功",
      b.reason,
      null,
      { results },
      req,
    );
    return { results };
  }
  need(false, "接口不存在", 404);
}
module.exports = { setup, enrich, endpoint };
