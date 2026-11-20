"use strict";
const crypto = require("node:crypto");
const R = require("./rules");
const { need } = R;
const { validate } = require("./content");
const now = () => new Date().toISOString();
const parse = (s, fallback = {}) => (s ? JSON.parse(s) : fallback);
const id = (prefix) => prefix + crypto.randomUUID();
const permissions = [
  "overview.view",
  "users.view",
  "users.sensitive",
  "users.manage",
  "users.export",
  "content.view",
  "content.edit",
  "content.publish",
  "content.export",
  "ai.view",
  "ai.sensitive",
  "ai.cost",
  "ai.edit",
  "ai.test",
  "ai.publish",
  "ai.credentials",
  "ai.export",
  "admin.manage",
  "logs.view",
];
const presets = {
  管理员: permissions,
  运营: [
    "overview.view",
    "users.view",
    "content.view",
    "content.edit",
    "logs.view",
  ],
  审核: ["overview.view", "content.view", "content.publish", "logs.view"],
  "AI 运营": [
    "overview.view",
    "ai.view",
    "ai.cost",
    "ai.edit",
    "ai.test",
    "logs.view",
  ],
  客服: ["users.view", "logs.view"],
};
function setup(s) {
  s.db.exec(`
CREATE TABLE IF NOT EXISTS user_meta(owner TEXT PRIMARY KEY,id TEXT UNIQUE NOT NULL,created TEXT,last TEXT,status TEXT DEFAULT '正常',note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS business_events(id TEXT PRIMARY KEY,owner TEXT,at TEXT,action TEXT,request TEXT,before_value TEXT,after_value TEXT,UNIQUE(owner,request));
CREATE TABLE IF NOT EXISTS favorite_events(id TEXT PRIMARY KEY,owner TEXT,move TEXT,at TEXT,kind TEXT,part TEXT,request TEXT,UNIQUE(owner,move,request));
CREATE TABLE IF NOT EXISTS operator_meta(name TEXT PRIMARY KEY,display TEXT,enabled INTEGER DEFAULT 1,created TEXT,last TEXT,creator TEXT,scope TEXT DEFAULT '{"users":"all","scenes":[],"environment":"all"}');
CREATE TABLE IF NOT EXISTS role_defs(name TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_events(id TEXT PRIMARY KEY,at TEXT,actor TEXT,roles TEXT,action TEXT,object TEXT,result TEXT,reason TEXT,before_value TEXT,after_value TEXT,request TEXT,ip TEXT,agent TEXT);
CREATE TABLE IF NOT EXISTS move_edits(id TEXT PRIMARY KEY,value TEXT NOT NULL,version INTEGER DEFAULT 0,draft TEXT,status TEXT DEFAULT '已发布',byname TEXT,at TEXT);
CREATE TABLE IF NOT EXISTS move_history(id TEXT,version INTEGER,value TEXT,at TEXT,actor TEXT,reason TEXT,PRIMARY KEY(id,version));
CREATE TABLE IF NOT EXISTS dictionaries(kind TEXT,name TEXT,value TEXT,version INTEGER DEFAULT 1,PRIMARY KEY(kind,name));`);
  s.db.exec('CREATE TABLE IF NOT EXISTS user_avatars(owner TEXT PRIMARY KEY,id TEXT UNIQUE,mime TEXT,data BLOB)');
  s.db.exec(
    "CREATE TABLE IF NOT EXISTS uploaded_media(hash TEXT PRIMARY KEY,data BLOB,at TEXT,actor TEXT);",
  );
  for (const e of s.all("SELECT id,value FROM move_edits"))
    if (!R.moves.has(e.id)) {
      const v = parse(e.value);
      R.moves.set(e.id, { ...v, id: e.id, sourceId: e.id });
    }
  for (const [name, value] of Object.entries(presets))
    s.run(
      "INSERT OR IGNORE INTO role_defs VALUES(?,?)",
      name,
      JSON.stringify(value),
    );
  for (const a of s.all("SELECT id FROM accounts")) user(s, a.id, false);
  for (const a of s.all("SELECT name FROM operators")) operatorMeta(s, a.name);
}
function operatorMeta(s, name) {
  const roles = parse(
    s.get("SELECT roles FROM operators WHERE name=?", name)?.roles,
    [],
  );
  s.run(
    "INSERT OR IGNORE INTO operator_meta(name,display,scope) VALUES(?,?,?)",
    name,
    name,
    JSON.stringify({
      users: roles.length === 1 && roles[0] === "客服" ? "assigned" : "all",
      scenes: [],
      environment: "all",
    }),
  );
  return s.get("SELECT * FROM operator_meta WHERE name=?", name);
}
function user(s, owner, fresh = false) {
  s.run(
    "INSERT OR IGNORE INTO user_meta(owner,id,created) VALUES(?,?,?)",
    owner,
    id("U"),
    fresh ? now() : null,
  );
  return s.get("SELECT * FROM user_meta WHERE owner=?", owner);
}
function principal(s, actor) {
  need(actor?.startsWith("op:"), "请登录管理后台", 401);
  const name = actor.slice(3),
    row = s.get("SELECT roles FROM operators WHERE name=?", name),
    meta = operatorMeta(s, name);
  need(row && meta.enabled, "账号已停用，请重新登录", 401);
  const roles = parse(row.roles, []),
    allowed = new Set(
      roles.flatMap((r) =>
        parse(s.get("SELECT value FROM role_defs WHERE name=?", r)?.value, []),
      ),
    );
  const scope = parse(meta.scope);
  return {
    name,
    display: meta.display,
    roles,
    permissions: [...allowed],
    scope,
    has: (p) => allowed.has(p),
    super: roles.includes("管理员"),
  };
}
function allow(p, key) {
  need(p.has(key), "当前账号没有此操作权限", 403);
}
function inScope(s, p, owner, scene, env = "production") {
  if (p.super) return true;
  if (p.scope.environment !== "all" && p.scope.environment !== env)
    return false;
  if (scene && p.scope.scenes?.length && !p.scope.scenes.includes(scene))
    return false;
  if (!owner || owner.startsWith("op:"))
    return owner === "op:" + p.name || p.scope.users === "all";
  if (p.scope.users === "all") return true;
  if (p.scope.users === "assigned")
    return !!s.get(
      "SELECT 1 FROM tickets WHERE owner=? AND assignee=?",
      owner,
      p.name,
    );
  return (
    Array.isArray(p.scope.users) && p.scope.users.includes(user(s, owner).id)
  );
}
function audit(
  s,
  actor,
  action,
  object,
  result = "成功",
  reason = "",
  before = null,
  after = null,
  req = {},
) {
  const p = actor?.startsWith("op:")
    ? s.get("SELECT roles FROM operators WHERE name=?", actor.slice(3))
    : null;
  s.run(
    "INSERT INTO admin_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id("L"),
    now(),
    actor || "未登录",
    p?.roles || "[]",
    action,
    String(object || ""),
    result,
    String(reason || "").slice(0, 1000),
    JSON.stringify(before),
    JSON.stringify(after),
    req.requestId || id("R"),
    req.socket?.remoteAddress || "",
    String(req.headers?.["user-agent"] || "").slice(0, 250),
  );
}
function record(s, owner, b, before, after) {
  const at = now();
  s.run(
    "INSERT INTO business_events VALUES(?,?,?,?,?,?,?)",
    id("E"),
    owner,
    at,
    b.action,
    b.requestId,
    JSON.stringify(before),
    JSON.stringify(after),
  );
  if (b.action === "sync") {
    const old = new Set(before.prefs.favorites),
      next = new Set(after.prefs.favorites);
    for (const move of new Set([...old, ...next]))
      if (old.has(move) !== next.has(move))
        s.run(
          "INSERT INTO favorite_events VALUES(?,?,?,?,?,?,?)",
          id("F"),
          owner,
          move,
          at,
          next.has(move) ? (b.body.merge ? "游客合并" : "添加") : "取消",
          s.content().actions.find((a) => a.id === R.moves.get(move)?.sourceId)
            ?.part ||
            R.moves.get(move)?.part ||
            "",
          b.requestId,
        );
  }
  s.run("UPDATE user_meta SET last=? WHERE owner=?", at, owner);
}
function catalog(s, c) {
  const edits = new Map(
    s.all("SELECT * FROM move_edits").map((e) => [e.id, e]),
  );
  return [
    ...new Map([...R.moves.values()].map((m) => [m.sourceId, m])).values(),
  ].map((m) => {
    const meta = c.actions.find((a) => a.id === m.sourceId),
      e = edits.get(m.sourceId),
      v = parse(e?.value);
    return {
      ...m,
      ...v,
      ...meta,
      id: m.sourceId,
      localId: m.id,
      visible: meta ? meta.visible !== false : !m.sourceId.startsWith("N"),
      enabled: !!meta?.enabled && !!meta?.approved,
      approved: !!meta?.approved,
      pattern: meta?.pattern || "",
      level: meta?.level || "未审核",
      unit: meta?.unit || (m.warmup ? "秒" : "次"),
      target: meta?.target || 10,
      rest: meta?.rest ?? 45,
      seconds: meta?.seconds || 3,
      alternatives: meta?.alternatives || m.alternatives || {},
      version: e?.version || 0,
      status: e?.status || "已发布",
      draft: parse(e?.draft, null),
      by: e?.byname || null,
      at: e?.at || null,
    };
  });
}
function data(s, p, b = {}) {
  const c = s.content(),
    result = {
      me: {
        name: p.name,
        display: p.display,
        roles: p.roles,
        permissions: p.permissions,
        scope: p.scope,
      },
      versions: c.version,
    };
  if (p.has("users.view")) {
    const rows = s
      .all(
        "SELECT a.*,m.id uid,m.created,m.last,m.status,m.note FROM accounts a JOIN user_meta m ON m.owner=a.id ORDER BY COALESCE(m.last,m.created,'') DESC,m.id",
      )
      .filter((a) => inScope(s, p, a.id));
    result.users = rows.map((a) => {
      const v = cleanSnapshot(parse(a.value), false),
        plans = Object.entries(v.weeks || {}).map(([start, w]) => ({
          id: "P" + a.uid.slice(1) + "_" + start,
          start,
          ...w,
        }));
      return {
        id: a.uid,
        name: v.identity?.nickname || "未设置昵称",
        avatar: v.identity?.avatar || '',
        created: a.created,
        last: a.last,
        status: a.status,
        note: a.note,
        prefs: v.prefs,
        plans,
        sessions: v.sessions,
        history: v.history,
        meals: Object.fromEntries(
          Object.entries(v.meals || {}).map(([k, m]) => [
            k,
            { ...m, profile: undefined, profileSnapshot: undefined },
          ]),
        ),
        profileProvided: !!v.profile,
      };
    });
    result.favoriteEvents = s
      .all(
        "SELECT f.*,u.id uid FROM favorite_events f JOIN user_meta u ON u.owner=f.owner ORDER BY at DESC",
      )
      .filter((e) => inScope(s, p, e.owner))
      .map(({ owner, ...e }) => e);
  }
  if (p.has("content.view") || p.has("users.view"))
    result.moves = catalog(s, c).map(({ draft, ...m }) =>
      p.has("content.edit") || p.has("content.publish") ? { ...m, draft } : m,
    );
  if (p.has("content.view"))
    result.dictionaries = s
      .all("SELECT * FROM dictionaries")
      .map((d) => ({ ...d, value: parse(d.value) }));
  if (p.has("admin.manage")) {
    result.staff = s
      .all(
        "SELECT o.name,o.roles,m.* FROM operators o LEFT JOIN operator_meta m ON m.name=o.name",
      )
      .map((a) => ({ ...a, roles: parse(a.roles), scope: parse(a.scope) }));
    result.roleDefs = s
      .all("SELECT * FROM role_defs")
      .map((r) => ({ name: r.name, permissions: parse(r.value) }));
    result.permissionKeys = permissions;
  }
  if (p.has("logs.view"))
    result.logs = s
      .all("SELECT * FROM admin_events ORDER BY at DESC LIMIT 1000")
      .filter((e) => p.super || e.actor === "op:" + p.name)
      .map((e) => ({
        ...e,
        roles: parse(e.roles),
        before: parse(e.before_value, null),
        after: parse(e.after_value, null),
        before_value: undefined,
        after_value: undefined,
      }));
  return require('./completion').enrich(s,p,result);
}
function endpoint(s, actor, action, b, req) {
  const p = principal(s, actor),
    reason = () =>
      need(typeof b.reason === "string" && b.reason.trim(), "请填写操作原因");
  if (action === "data") {
    audit(
      s,
      actor,
      "查询管理数据",
      "工作空间",
      "成功",
      "",
      null,
      { scope: p.scope },
      req,
    );
    return data(s, p, b);
  }
  if (action === "media-upload") {
    allow(p, "content.edit");
    need(
      typeof b.data === "string" && b.data.length <= 5600000,
      "素材不得超过4MB",
    );
    const bytes = Buffer.from(b.data, "base64");
    need(
      bytes.length > 20 &&
        bytes.subarray(0, 4).toString() === "RIFF" &&
        bytes.subarray(8, 12).toString() === "WEBP",
      "请上传 WebP 图片或动图",
    );
    const hash = crypto.createHash("sha1").update(bytes).digest("hex");
    s.run(
      "INSERT OR IGNORE INTO uploaded_media VALUES(?,?,?,?)",
      hash,
      bytes,
      now(),
      actor,
    );
    audit(
      s,
      actor,
      action,
      hash,
      "成功",
      "上传动作素材",
      null,
      { bytes: bytes.length },
      req,
    );
    return { hash, url: "/uploaded/" + hash + ".webp" };
  }
  if (action === "move-new") {
    allow(p, "content.edit");
    need(
      typeof b.name === "string" &&
        b.name.trim() &&
        Array.isArray(b.steps) &&
        b.steps.length,
      "请填写名称和步骤",
    );
    const mid = "N" + crypto.randomBytes(6).toString("hex");
    const value = {
      id: mid,
      sourceId: mid,
      name: b.name,
      steps: b.steps,
      part: b.part || "全身",
      muscle: b.muscle || "待补充",
      gear: [],
      visible: false,
      enabled: false,
      approved: false,
    };
    s.run(
      "INSERT INTO move_edits VALUES(?,?,0,?,?,?,?)",
      mid,
      JSON.stringify(value),
      JSON.stringify(value),
      "草稿",
      actor,
      now(),
    );
    R.moves.set(mid, value);
    audit(
      s,
      actor,
      action,
      mid,
      "成功",
      "新增未发布动作",
      null,
      { name: b.name },
      req,
    );
    return { id: mid };
  }
  if (action === "move-delete") {
    allow(p, "content.edit");
    reason();
    const e = s.get("SELECT * FROM move_edits WHERE id=?", b.id);
    need(
      e && b.id.startsWith("N") && e.version === 0,
      "仅可删除尚未发布的新动作草稿",
    );
    need(
      !s.all("SELECT value FROM accounts").some((a) => a.value.includes(b.id)),
      "动作已有用户引用，不能删除",
    );
    s.run("DELETE FROM move_edits WHERE id=?", b.id);
    R.moves.delete(b.id);
    audit(s, actor, action, b.id, "成功", b.reason);
    return {};
  }
  if (action === "user") {
    allow(p, "users.view");
    const u = s.get("SELECT * FROM user_meta WHERE id=?", b.id);
    need(u, "记录不存在或已清理", 404);
    need(inScope(s, p, u.owner), "无权查看该用户", 403);
    audit(
      s,
      actor,
      "查询用户详情",
      u.id,
      "成功",
      "",
      null,
      { sensitive: !!b.sensitive },
      req,
    );
    const a = s.account(u.owner),
      events = s.all(
        "SELECT * FROM business_events WHERE owner=? ORDER BY at DESC",
        u.owner,
      );
    let profile;
    if (b.sensitive) {
      allow(p, "users.sensitive");
      reason();
      profile = a.profile;
      audit(
        s,
        actor,
        "读取敏感资料",
        u.id,
        "成功",
        b.reason,
        null,
        { fields: ["身体资料", "过敏原", "资料历史"] },
        req,
      );
    }
    return {
      profile,
      ...(b.sensitive ? { measurements: a.measurements || {}, energyHistory: a.energyHistory || [], pendingEnergy: a.pendingEnergy || null, energyFeedback: a.energyFeedback || {} } : {}),
      events: events.map((e) => ({
        id: e.id,
        at: e.at,
        action: e.action,
        request: e.request,
        before: cleanSnapshot(parse(e.before_value), !!b.sensitive),
        after: cleanSnapshot(parse(e.after_value), !!b.sensitive),
      })),
      tickets: s.all(
        "SELECT id,kind,status,detail,assignee,at FROM tickets WHERE owner=?",
        u.owner,
      ),
    };
  }
  if (action === "user-status" || action === "user-note") {
    allow(p, action === "user-status" ? "users.manage" : "users.view");
    reason();
    const u = s.get("SELECT * FROM user_meta WHERE id=?", b.id);
    need(u && inScope(s, p, u.owner), "无此用户权限", 403);
    if (action === "user-status") {
      need(["正常", "已限制"].includes(b.status), "账号状态无效");
      s.run("UPDATE user_meta SET status=? WHERE id=?", b.status, b.id);
      s.run("DELETE FROM sessions WHERE owner=?", u.owner);
    } else {
      need(
        typeof b.note === "string" && b.note.length <= 2000,
        "备注须在2000字以内",
      );
      s.run("UPDATE user_meta SET note=? WHERE id=?", b.note, b.id);
    }
    audit(
      s,
      actor,
      action,
      b.id,
      "成功",
      b.reason,
      action === "user-status" ? u.status : u.note,
      action === "user-status" ? b.status : b.note,
      req,
    );
    return {};
  }
  if (
    action === "staff-save" ||
    action === "staff-state" ||
    action === "staff-logout"
  ) {
    allow(p, "admin.manage");
    reason();
    const current = s.get("SELECT * FROM operators WHERE name=?", b.name),
      meta = current && operatorMeta(s, b.name);
    if (action === "staff-save") {
      need(
        typeof b.name === "string" && /^[a-zA-Z0-9_.@-]{2,80}$/.test(b.name),
        "账号须为2–80位字母数字或 _.@-",
      );
      need(
        Array.isArray(b.roles) &&
          b.roles.length &&
          b.roles.every((r) =>
            s.get("SELECT 1 FROM role_defs WHERE name=?", r),
          ),
        "请选择有效角色",
      );
      const granted = new Set(
        b.roles.flatMap((r) =>
          parse(s.get("SELECT value FROM role_defs WHERE name=?", r).value),
        ),
      );
      need(
        [...granted].every((k) => p.has(k)),
        "不能授予超出本人权限的角色",
        403,
      );
      need(
        b.scope &&
          (["all", "assigned"].includes(b.scope.users) ||
            Array.isArray(b.scope.users)) &&
          ["all", "production", "test"].includes(b.scope.environment) &&
          Array.isArray(b.scope.scenes),
        "数据范围无效",
      );
      need(
        p.super || JSON.stringify(b.scope) === JSON.stringify(p.scope),
        "只有超级管理员可扩大数据范围",
        403,
      );
      keepAdmin(s, b.name, b.roles, true);
      if (b.password || !current) {
        need(
          typeof b.password === "string" && b.password.length >= 12,
          "密码至少12位",
        );
        const salt = crypto.randomBytes(16).toString("hex");
        s.run(
          "INSERT OR REPLACE INTO operators VALUES(?,?,?,?)",
          b.name,
          salt,
          crypto.scryptSync(b.password, salt, 32).toString("hex"),
          JSON.stringify(b.roles),
        );
      } else
        s.run(
          "UPDATE operators SET roles=? WHERE name=?",
          JSON.stringify(b.roles),
          b.name,
        );
      operatorMeta(s, b.name);
      s.run(
        "UPDATE operator_meta SET display=?,scope=?,created=COALESCE(created,?),creator=COALESCE(creator,?) WHERE name=?",
        String(b.display || b.name).slice(0, 100),
        JSON.stringify(b.scope),
        now(),
        p.name,
        b.name,
      );
      audit(
        s,
        actor,
        "管理员授权",
        b.name,
        "成功",
        b.reason,
        current
          ? { roles: parse(current.roles), scope: parse(meta.scope) }
          : null,
        { roles: b.roles, scope: b.scope, passwordChanged: !!b.password },
        req,
      );
    } else {
      need(current, "管理员不存在", 404);
      if (action === "staff-state") {
        keepAdmin(s, b.name, parse(current.roles), !!b.enabled);
        s.run(
          "UPDATE operator_meta SET enabled=? WHERE name=?",
          b.enabled ? 1 : 0,
          b.name,
        );
      }
      audit(
        s,
        actor,
        action,
        b.name,
        "成功",
        b.reason,
        null,
        { enabled: b.enabled },
        req,
      );
    }
    s.run("DELETE FROM sessions WHERE owner=?", "op:" + b.name);
    return {};
  }
  if (action === "role-save") {
    allow(p, "admin.manage");
    reason();
    need(p.super, "仅超级管理员可修改角色定义", 403);
    need(b.name !== "管理员", "超级管理员内置权限不能收回");
    need(
      typeof b.name === "string" &&
        b.name.trim() &&
        b.name.length <= 40 &&
        Array.isArray(b.permissions) &&
        b.permissions.every((k) => permissions.includes(k) && p.has(k)),
      "权限无效",
    );
    const before = parse(
      s.get("SELECT value FROM role_defs WHERE name=?", b.name)?.value,
      [],
    );
    s.run(
      "INSERT OR REPLACE INTO role_defs VALUES(?,?)",
      b.name,
      JSON.stringify([...new Set(b.permissions)]),
    );
    const affected = s
      .all("SELECT name,roles FROM operators")
      .filter((o) => parse(o.roles).includes(b.name));
    for (const o of affected)
      s.run("DELETE FROM sessions WHERE owner=?", "op:" + o.name);
    audit(
      s,
      actor,
      "角色权限变更",
      b.name,
      "成功",
      b.reason,
      before,
      { permissions: b.permissions, affected: affected.map((a) => a.name) },
      req,
    );
    return {};
  }
  if (action.startsWith("move-"))
    return moveAction(s, p, actor, action, b, req);
  if (action === "taxonomy-save") {
    need(b.value&&Array.isArray(b.value.aliases)&&b.value.aliases.every(x=>typeof x==='string'&&x.length<100),'别名格式无效');
    need(b.value.order==null||Number.isFinite(b.value.order),'排序无效');
    if(b.value.image)need(/^\/uploaded\/[a-f0-9]{40}\.webp$/.test(b.value.image)&&s.get('SELECT 1 FROM uploaded_media WHERE hash=?',b.value.image.split('/').pop().split('.')[0]),'请先上传参考图');
    allow(p, "content.edit");
    reason();
    need(
      ["部位", "肌群", "器械"].includes(b.kind) &&
        typeof b.name === "string" &&
        b.name.trim(),
      "分类无效",
    );
    const refs = catalog(s, s.content()).filter((m) =>
      b.kind === "器械"
        ? m.gear.includes(b.name)
        : b.kind === "部位"
          ? m.part === b.name
          : m.muscle === b.name,
    ).length;
    need(
      b.value?.enabled !== false || !refs,
      "此分类仍被 " + refs + " 个动作引用，先迁移关联动作",
    );
    const before = s.get(
      "SELECT * FROM dictionaries WHERE kind=? AND name=?",
      b.kind,
      b.name,
    );
    need((before?.version || 0) === (b.base || 0), "分类版本已变化", 409);
    s.run(
      "INSERT OR REPLACE INTO dictionaries VALUES(?,?,?,?)",
      b.kind,
      b.name,
      JSON.stringify(b.value),
      (before?.version || 0) + 1,
    );
    audit(
      s,
      actor,
      action,
      b.name,
      "成功",
      b.reason,
      before ? parse(before.value) : null,
      b.value,
      req,
    );
    return {};
  }
  if (action === "export") {
    const key = {
      users: "users.export",
      favorites: "users.export",
      plans: "users.export",
      meals: "users.export",
      moves: "content.export",
    }[b.module];
    need(key, "不支持此导出");
    allow(p, key);
    reason();
    const d = data(s, p),
      rows = b.module === "moves" ? d.moves : d.users;
    const selected = (rows || []).filter((x) => !b.ids || b.ids.includes(x.id));
    audit(
      s,
      actor,
      "导出",
      b.module,
      "成功",
      b.reason,
      null,
      { count: selected.length },
      req,
    );
    return { rows: selected };
  }
  need(false, "管理接口不存在", 404);
}
function cleanSnapshot(v, sensitive) {
  if (!sensitive) {
    v.profile = v.profile ? { redacted: true } : null;
    for (const k of ['measurements', 'energyHistory', 'pendingEnergy', 'energyFeedback', 'consumedMeals']) delete v[k];
    for (const s of [...Object.values(v.sessions || {}), ...(v.history || [])]) {
      delete s.energyPerson;
      delete s.energyEstimate;
    }
    for (const m of Object.values(v.meals || {})) {
      delete m.profile;
      delete m.profileSnapshot;
    }
  }
  return v;
}
function keepAdmin(s, name, roles, enabled) {
  if (enabled && roles.includes("管理员")) return;
  need(
    s
      .all(
        "SELECT o.name,o.roles,COALESCE(m.enabled,1) enabled FROM operators o LEFT JOIN operator_meta m ON m.name=o.name",
      )
      .some(
        (o) =>
          o.name !== name && o.enabled && parse(o.roles).includes("管理员"),
      ),
    "至少保留一名可用的超级管理员",
  );
}
function moveAction(s, p, actor, action, b, req) {
  allow(
    p,
    action === "move-history"
      ? "content.view"
      : [
            "move-publish",
            "move-status",
            "move-rollback",
            "move-reject",
            "move-bulk",
          ].includes(action)
        ? "content.publish"
        : "content.edit",
  );
  const c = s.content(),
    all = catalog(s, c);
  if (action === "move-history") {
    allow(p, "content.view");
    return s
      .all("SELECT * FROM move_history WHERE id=? ORDER BY version DESC", b.id)
      .map((v) => ({ ...v, value: parse(v.value) }));
  }
  if (action === "move-bulk") {
    need(
      Array.isArray(b.ids) && b.ids.length > 0 && b.ids.length <= 100,
      "每批选择1–100个动作",
    );
    need(b.reason?.trim(), "请填写操作原因");
    const results = [];
    for (const moveId of b.ids) {
      s.db.exec("SAVEPOINT bulk_item");
      try {
        moveAction(
          s,
          p,
          actor,
          "move-status",
          { ...b, id: moveId, base: all.find((m) => m.id === moveId)?.version },
          req,
        );
        s.db.exec("RELEASE bulk_item");
        results.push({ id: moveId, ok: true });
      } catch (e) {
        s.db.exec("ROLLBACK TO bulk_item; RELEASE bulk_item");
        results.push({ id: moveId, ok: false, error: e.message });
      }
    }
    audit(
      s,
      actor,
      action,
      "批量动作",
      results.every((x) => x.ok) ? "成功" : "部分成功",
      b.reason,
      null,
      { results },
      req,
    );
    return { results };
  }
  const m = all.find((m) => m.id === b.id);
  need(m, "动作不存在", 404);
  if (action === "move-draft") {
    need(b.base === m.version, "动作版本已变化，请刷新", 409);
    const v = { ...m, ...b.value, id: m.id };
    need(
      typeof v.name === "string" &&
        v.name.trim() &&
        v.name.length <= 120 &&
        Array.isArray(v.steps) &&
        v.steps.length &&
        v.steps.length <= 100 &&
        v.steps.every((x) => typeof x === "string" && x.length <= 2000),
      "请填写名称与动作步骤",
    );
    need(
      Array.isArray(v.gear) && v.gear.every((g) => R.gearList.includes(g)),
      "存在未登记器械",
    );
    if(v.replacements) need(Array.isArray(v.replacements)&&v.replacements.every(id=>id!==m.id&&all.some(a=>a.id===id)),"替换候选不存在或引用自身");
    for(const field of ['secondaryMuscles','optionalGear','tips','tags','aliases']) if(v[field]) need(Array.isArray(v[field])&&v[field].every(x=>typeof x==='string'&&x.length<2000),'扩展字段格式无效');
    if(v.optionalGear) need(v.optionalGear.every(g=>R.gearList.includes(g)),'可选器械未登记');
    const clean = {};
    for (const k of [
      "name",
      "part",
      "muscle",
      "gear",
      "steps",
      "aliases",
      "replacements", "originalName", "originalDescription", "secondaryMuscles", "optionalGear", "tips", "source", "tags",
      "level",
      "warmup",
      "pattern",
      "unit",
      "target",
      "rest",
      "seconds",
      "alternatives",
      "visible",
      "enabled",
      "approved",
      "media",
    ])
      if (v[k] !== undefined) clean[k] = v[k];
    if (clean.media)
      for (const kind of ["cover", "animation"]) {
        const hash = clean.media[kind + "Hash"];
        need(
          /^[a-f0-9]{40}$/.test(hash) &&
            s.get("SELECT 1 FROM uploaded_media WHERE hash=?", hash),
          "请先上传完整封面与动图",
        );
        clean.media[kind] =
          (process.env.LIANNA_PUBLIC_ORIGIN ||
            "https://admin.yijiandot.com.cn") +
          "/uploaded/" +
          hash +
          ".webp";
      }
    s.run("INSERT OR IGNORE INTO move_edits(id,value) VALUES(?,?)", b.id, "{}");
    s.run(
      "UPDATE move_edits SET draft=?,status='草稿',byname=?,at=? WHERE id=?",
      JSON.stringify(clean),
      actor,
      now(),
      b.id,
    );
    audit(
      s,
      actor,
      action,
      b.id,
      "成功",
      b.reason || "保存草稿",
      null,
      clean,
      req,
    );
    return {};
  }
  const row = s.get("SELECT * FROM move_edits WHERE id=?", b.id);
  if (action === "move-submit" || action === "move-reject") {
    need(row?.draft, "没有待处理草稿");
    if (action === "move-reject") need(b.reason?.trim(), "请填写退回原因");
    s.run(
      "UPDATE move_edits SET status=? WHERE id=?",
      action === "move-submit" ? "待审核" : "已退回",
      b.id,
    );
    audit(s, actor, action, b.id, "成功", b.reason, null, null, req);
    return {};
  }
  need(b.reason?.trim(), "请填写操作原因");
  need(m.version === b.base, "动作基线已变化", 409);
  let next =
    action === "move-status"
      ? { ...m, visible: !!b.visible, enabled: b.visible ? m.enabled : false }
      : action === "move-rollback"
        ? parse(
            s.get(
              "SELECT value FROM move_history WHERE id=? AND version=?",
              b.id,
              b.version,
            )?.value,
            null,
          )
        : parse(row?.draft, null);
  need(next, "目标版本不存在");
  if (action === "move-publish")
    need(row.status === "待审核", "请先提交审核", 409);
  if (m.id.startsWith("N"))
    need(
      next.media?.cover && next.media?.animation,
      "新动作须先上传封面与动图",
    );
  if (next.enabled)
    need(
      next.approved &&
        next.visible !== false &&
        next.pattern &&
        next.steps?.length,
      "自动排课需上架、审核与完整属性",
    );
  const values = c.actions.filter((a) => a.id !== b.id),
    meta = {
      id: b.id,
      name: next.name,
      visible: next.visible !== false,
      enabled: !!next.enabled,
      approved: !!next.approved,
      pattern: next.pattern,
      level: next.level,
      unit: next.unit,
      target: Number(next.target),
      rest: Number(next.rest),
      seconds: Number(next.seconds),
      gear: next.gear,
      alternatives: next.alternatives,
      steps: next.steps,
      part: next.part,
      muscle: next.muscle,
    };
  Object.assign(meta, {
    media: next.media,
    warmup: !!next.warmup,
    aliases: next.aliases || [],
    sourceId: m.id,
  });
  values.push(meta);
  validate("actions", values);
  s.publish(actor, "actions", c.version.actions, values, b.reason);
  s.run(
    "INSERT OR IGNORE INTO move_history VALUES(?,?,?,?,?,?)",
    b.id,
    m.version,
    JSON.stringify({ ...m, draft: undefined }),
    now(),
    actor,
    "变更前基线",
  );
  const clean = {};
  for (const k of [
    "name",
    "part",
    "muscle",
    "gear",
    "steps",
    "aliases",
    "replacements", "originalName", "originalDescription", "secondaryMuscles", "optionalGear", "tips", "source", "tags",
    "warmup",
  ])
    if (next[k] !== undefined) clean[k] = next[k];
  s.run(
    "INSERT OR REPLACE INTO move_edits VALUES(?,?,?,?,?,?,?)",
    b.id,
    JSON.stringify(clean),
    m.version + 1,
    null,
    "已发布",
    actor,
    now(),
  );
  s.run(
    "INSERT INTO move_history VALUES(?,?,?,?,?,?)",
    b.id,
    m.version + 1,
    JSON.stringify({ ...next, draft: undefined }),
    now(),
    actor,
    b.reason,
  );
  audit(
    s,
    actor,
    action,
    b.id,
    "成功",
    b.reason,
    { ...m, draft: undefined },
    { ...next, draft: undefined, version: m.version + 1 },
    req,
  );
  return { version: m.version + 1 };
}
module.exports = {
  setup,
  user,
  principal,
  allow,
  inScope,
  audit,
  record,
  catalog,
  endpoint,
  operatorMeta,
  now,
  id,
  parse,
};
