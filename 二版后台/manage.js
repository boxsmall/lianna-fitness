"use strict";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
let token = sessionStorage.getItem("lianna.admin") || "",
  D = {},
  A = { generations: [], calls: [], bills: [] },
  filtersState = {},
  selected = new Set(),
  detail = {},
  config = {},
  pending = null,
  renderId = 0,
  modalVersion = 0;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pre = (v) => `<pre class="code">${esc(JSON.stringify(v, null, 2))}</pre>`;
const time = (v) =>
  v
    ? new Date(
        v.includes("T") || v.includes("+") ? v : v.replace(" ", "T") + "Z",
      ).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })
    : "未记录";
const money = (v) =>
  v == null
    ? "待回补"
    : Math.abs(Number(v)) > 0 && Math.abs(Number(v)) < 0.000001
      ? "＜ ¥0.000001"
      : "¥ " + Number(v).toFixed(6);
const badge = (s) =>
  `<span class="badge ${["正常", "启用", "已发布", "成功", "成功交付", "账单确认", "已完成", "已上架", "可排课", "已保存"].includes(s) ? "green" : ["失败", "已限制", "已停用"].includes(s) ? "red" : ["未纳入", "正式动作", "热身"].includes(s) ? "gray" : "orange"}"><i class="dot"></i>${esc(s || "未记录")}</span>`;
const btn = (s, a, cls = "", extra = "") =>
  `<button type="button" class="btn ${cls}" data-action="${esc(a)}" ${extra}>${esc(s)}</button>`;
const link = (s, path) => `<a href="#/${esc(path)}">${esc(s)}</a>`;
const section = (name, body, extra = "") =>
  `<section class="section">${name ? `<div class="section-head"><h2>${esc(name)}</h2>${extra}</div>` : ""}<div class="section-body">${body}</div></section>`;
const table = (heads, rows) =>
  `<div class="table-wrap"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((v) => `<td>${v ?? "—"}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${heads.length}"><div class="empty"><h2>没有匹配的记录</h2>尚未产生或同步记录，也可调整筛选条件。</div></td></tr>`}</tbody></table></div>`;
const title = (h, sub = "", buttons = "") =>
  `<div class="page-head"><div><h1>${esc(h)}</h1><p>${esc(sub)}</p></div><div class="actions">${buttons}</div></div>`;
const note = (s, warn = false) =>
  `<div class="note ${warn ? "warn" : ""}">${esc(s)}</div>`;
const kv = (rows) =>
  `<div class="kv-grid">${rows.map(([k, v]) => `<div><div class="kv-label">${esc(k)}</div><div class="kv-value">${v ?? "未填写"}</div></div>`).join("")}</div>`;
const summary = (rows) =>
  `<div class="summary-strip">${rows.map(([k, v, sub, path]) => `<div class="summary-cell">${path ? `<a href="#/${path}">` : ""}<span class="muted">${esc(k)}</span><div class="value">${esc(v)}</div><small>${esc(sub || "")}</small>${path ? "</a>" : ""}</div>`).join("")}</div>`;
const field = (label, name, value = "", type = "text") =>
  `<label class="field">${esc(label)}${type === "textarea" ? `<textarea name="${name}">${esc(value)}</textarea>` : `<input name="${name}" type="${type}" value="${esc(value)}" ${type === "number" ? 'step="any"' : ""} ${type === "password" ? 'autocomplete="new-password"' : ""}>`}</label>`;
const select = (label, name, values, value = "") =>
  `<label class="field">${esc(label)}<select name="${name}">${values.map((v) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`;
const multi = (name, options, values = []) =>
  `<details class="multi"><summary>已选 ${values.length} 项 · 下拉多选</summary><div>${options.map((v) => `<label class="check"><input type="checkbox" name="${name}" value="${esc(v)}" ${values.includes(v) ? "checked" : ""}>${esc(v)}</label>`).join("")}</div></details>`;
const route = () => {
  const [path, q = ""] = (location.hash.slice(1) || "/users").split("?"),
    p = path.split("/").filter(Boolean);
  return {
    page: p[0] || "users",
    id: decodeURIComponent(p[1] || ""),
    params: new URLSearchParams(q),
  };
};
const tabs = (values, base) =>
  `<div class="tabs plain">${values.map(([id, label]) => `<a class="${(route().params.get("tab") || base) === id ? "on" : ""}" href="#/${route().page}/${encodeURIComponent(route().id)}?tab=${encodeURIComponent(id)}">${esc(label)}</a>`).join("")}</div>`;
const can = (p) => D.me?.permissions.includes(p),
  user = (id) => D.users?.find((u) => u.id === id),
  move = (id) => D.moves?.find((m) => m.id === id || m.localId === id);
const userLink = (id) =>
    id?.startsWith("op:") ? esc(id) : link(user(id)?.name || id, "user/" + id),
  moveLink = (id) => link(move(id)?.name || id, "move/" + (move(id)?.id || id));
const groups = [
  ["数据概览", [["overview", "运营概览", "overview.view"]]],
  [
    "用户中心",
    [
      ["users", "用户列表", "users.view"],
      ["favorites", "收藏记录", "users.view"],
      ["plans", "训练计划", "users.view"],
      ["meals", "饮食记录", "users.view"],
    ],
  ],
  [
    "动作库管理",
    [
      ["moves", "全部动作", "content.view"],
      ["taxonomy", "部位、肌群与器械", "content.view"],
      ["templates", "训练模板与规则", "content.view"],
    ],
  ],
  [
    "AI 中心",
    [
      ["generations", "生成记录", "ai.view"],
      ["calls", "调用与消费明细", "ai.cost"],
      ["costs", "费用统计", "ai.cost"],
      ["config", "模型与生成配置", "ai.edit"],
    ],
  ],
  [
    "系统管理",
    [
      ["staff", "管理人员", "admin.manage"],
      ["roles", "角色与权限", "admin.manage"],
      ["logs", "操作日志", "logs.view"],
    ],
  ],
];
const names = Object.fromEntries(
  groups.flatMap((g) => g[1]).map(([k, v]) => [k, v]),
);
function toast(s) {
  $("#toast").textContent = s;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($("#toast").textContent = ""), 5000);
}
async function api(path, data = {}) {
  const r = await fetch("/api/" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(data),
    }),
    v = await r.json();
  if (!r.ok) {
    if (r.status === 401) {
      token = "";
      sessionStorage.removeItem("lianna.admin");
      $("#workspace").hidden = true;
      $("#login").hidden = false;
    }
    throw Error(v.error || "请求未完成");
  }
  return v;
}
const call = (name, b = {}) => api("admin/v3/" + name, b),
  ledger = (name, b = {}) => api("admin/ledger/" + name, b);
async function load() {
  D = await call("data");
  A = can("ai.view")
    ? await ledger("data")
    : { generations: [], calls: [], bills: [] };
  $("#workspace").hidden = false;
  $("#login").hidden = true;
  $("#identity").textContent = D.me.display + " · " + D.me.roles.join(" / ");
  await render();
}
function shell() {
  const r = route(),
    parent =
      {
        user: "users",
        staffdetail: "staff",
        foods: "templates",
        nutrition: "templates",
        plan: "plans",
        meal: "meals",
        move: "moves",
        generation: "generations",
        call: "calls",
      }[r.page] || r.page;
  $("#sidebar").innerHTML =
    `<a class="logo" href="#/users"><img src="/brand.svg" alt="练哪"><span>管理控制台</span></a><nav class="nav-scroll">${groups
      .map(([g, items]) =>
        items.some((i) => can(i[2]))
          ? `<div class="nav-group">${g}</div>${items
              .filter((i) => can(i[2]))
              .map(
                ([id, label]) =>
                  `<a href="#/${id}" class="nav-link ${parent === id ? "active" : ""}">${label}${id === "moves" ? `<span class="nav-num">${D.moves?.length || 0}</span>` : ""}</a>`,
              )
              .join("")}`
          : "",
      )
      .join(
        "",
      )}</nav><div class="side-foot">管理控制台<br>正式数据 · 操作留痕</div>`;
  $("#breadcrumb").innerHTML =
    `工作空间 <span>/</span> <b>${esc(names[parent] || "详情")}</b>${r.id ? "<span>/</span> 详情" : ""}`;
}
function filters(fields = [], placeholder = "搜索名称或编号") {
  const f = filtersState[route().page] || {};
  return `<form class="filters" id="filter-form"><input type="search" name="q" placeholder="${placeholder}" value="${esc(f.q || "")}" aria-label="搜索">${fields.map(([k, label, values]) => `<select name="${k}" aria-label="${label}"><option value="">${label}</option>${values.map((v) => `<option ${f[k] === v ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>`).join("")}${["moves", "taxonomy", "roles", "foods", "nutrition"].includes(route().page) ? "" : `<input type="date" name="from" aria-label="开始日期" value="${esc(f.from || "")}"><input type="date" name="to" aria-label="结束日期" value="${esc(f.to || "")}">`}<button class="btn primary">查询</button>${btn("重置", "reset", "text-btn")}</form>`;
}
const localDay = (v) =>
  new Date(new Date(v).getTime() + 8 * 3600000).toISOString().slice(0, 10);
function filtered(rows, text, fields = {}) {
  const r = route(),
    f = filtersState[r.page] || {},
    uid = r.params.get("user");
  return rows.filter(
    (x) =>
      (!uid || x.user === uid || x.id === uid) &&
      (!f.q || String(text(x)).toLowerCase().includes(f.q.toLowerCase())) &&
      Object.entries(fields).every(([k, fn]) => !f[k] || fn(x) === f[k]) &&
      (!f.from ||
        (!!(x.at || x.created || x.start) &&
          localDay(x.at || x.created || x.start) >= f.from)) &&
      (!f.to ||
        (!!(x.at || x.created || x.start) &&
          localDay(x.at || x.created || x.start) <= f.to)),
  );
}
function page(rows, heads, fn, size = 10) {
  const r = route(),
    f = filtersState[r.page] || {},
    max = Math.max(1, Math.ceil(rows.length / size)),
    n = Math.max(1, Math.min(f.page || 1, max));
  return (
    table(heads, rows.slice((n - 1) * size, n * size).map(fn)) +
    `<div class="pagination"><span>共 ${rows.length.toLocaleString()} 条 · 每页 ${size} 条</span><div class="actions">${btn("上一页", "page:" + (n - 1), "", n <= 1 ? "disabled" : "")}<span>第 ${n} / ${max} 页</span>${btn("下一页", "page:" + (n + 1), "", n >= max ? "disabled" : "")}</div></div>`
  );
}
function sumMoney(values) {
  return (
    Number(
      values.reduce((n, v) => {
        const [i, f = ""] = String(v || "0").split(".");
        return (
          n +
          BigInt(i) * 1000000000000n +
          (i.startsWith("-") ? -1n : 1n) *
            BigInt(f.padEnd(12, "0").slice(0, 12))
        );
      }, 0n),
    ) / 1e12
  );
}
function prices(cs) {
  return {
    confirmed: sumMoney(cs.map((c) => c.confirmed)),
    pending: sumMoney(
      cs.filter((c) => c.confirmed == null).map((c) => c.estimate),
    ),
    unknown: cs.filter((c) => c.confirmed == null && c.estimate == null).length,
  };
}
function costCell(cs) {
  if (!can("ai.cost")) return "无费用查看权限";
  const x = prices(cs);
  return `<span class="money">${money(x.confirmed)}</span><span class="sub">已确认 · 待确认 ${money(x.pending)}${x.unknown ? " · " + x.unknown + " 笔未知" : ""}</span>`;
}
const callsOf = (g) => A.calls.filter((c) => c.generation === g),
  userCalls = (id) =>
    A.calls.filter(
      (c) => A.generations.find((g) => g.id === c.generation)?.user === id,
    );
const plans = () =>
  D.users?.flatMap((u) => u.plans.map((p) => ({ ...p, user: u.id }))) || [];
const meals = () =>
  D.users?.flatMap((u) =>
    Object.entries(u.meals).map(([key, m]) => ({
      ...m,
      id: "M" + u.id.slice(1) + "_" + key,
      key,
      user: u.id,
      at: m.savedAt,
    })),
  ) || [];
const favorites = () =>
  D.users?.flatMap((u) =>
    u.prefs.favorites.map((mid) => ({
      id: u.id + "_" + mid,
      user: u.id,
      move: mid,
      at: D.favoriteEvents?.find(
        (e) => e.uid === u.id && e.move === mid && e.kind !== "取消",
      )?.at,
    })),
  ) || [];
const shift = (day, n) => {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
async function render() {
  const ticket = ++renderId,
    r = route();
  for (const key of [
    "from",
    "to",
    "environment",
    "model",
    "scene",
    "part",
    "gear",
    "muscle",
    "review",
    "status",
    "user",
    "dateField",
    "generationStatus",
    "billing",
    "environment",
  ])
    if (r.params.has(key))
      filtersState[r.page] = {
        ...filtersState[r.page],
        [key]: r.params.get(key),
      };
  shell();
  const parent =
      {
        user: "users",
        staffdetail: "staff",
        foods: "templates",
        nutrition: "templates",
        plan: "plans",
        meal: "meals",
        move: "moves",
        generation: "generations",
        call: "calls",
      }[r.page] || r.page,
    perm = groups.flatMap((g) => g[1]).find((v) => v[0] === parent)?.[2];
  if (perm && !can(perm)) {
    $("#app").innerHTML = note(
      "当前账号无权进入此页面，请联系管理员分配权限。",
    );
    return;
  }
  try {
    const html = await (views[r.page] || usersPage)();
    if (ticket === renderId) $("#app").innerHTML = html;
  } catch (e) {
    if (ticket === renderId) $("#app").innerHTML = note(e.message, true);
  }
}
function modal(h, body, submit) {
  modalVersion++;
  $("#dialog").innerHTML =
    `<div class="dialog-head"><h2>${esc(h)}</h2>${btn("关闭", "close", "text-btn")}</div><form id="modal-form"><div class="dialog-body">${body}</div><div class="dialog-foot">${btn("取消", "close")}${submit ? '<button class="btn primary">确认保存</button>' : ""}</div></form>`;
  pending = submit;
  if (!$("#dialog").open) $("#dialog").showModal();
}
function confirm(h, body, fn) {
  modal(
    h,
    body +
      `<div class="top-space">${field("操作原因", "reason", "", "textarea")}</div>`,
    async (f) => {
      const reason = f.get("reason").trim();
      if (!reason) throw Error("请填写操作原因");
      await fn(reason);
    },
  );
}
async function refresh() {
  detail = {};
  config = {};
  await load();
}
function download(rows, name) {
  const text =
      "\ufeff" +
      rows
        .map((row) =>
          row
            .map(
              (v) =>
                '"' +
                String(v ?? "")
                  .replace(/^[=+@-]/, "'$&")
                  .replaceAll('"', '""') +
                '"',
            )
            .join(","),
        )
        .join("\r\n"),
    url = URL.createObjectURL(
      new Blob([text], { type: "text/csv;charset=utf-8" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name + ".csv";
  a.click();
  URL.revokeObjectURL(url);
}
