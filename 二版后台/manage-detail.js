"use strict";
// Detailed screens share the same records and permission checks as the lists.
const complete = (name, b = {}) => api("admin/complete/" + name, b);
const xbtn = (s, a, cls = "") =>
  btn(s, a, cls).replace("data-action=", "data-complete=");
const kvList = (rows) =>
  `<div class="kv-list">${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${v ?? "未记录"}</b></div>`).join("")}</div>`;
const listText = (v) =>
  Array.isArray(v) ? v.join("、") || "无" : v || "未填写";
const numberText = (v, unit = "") => (v == null ? "未记录" : esc(v) + unit);
const duration = (a, b) =>
  a && b ? ((new Date(b) - new Date(a)) / 1000).toFixed(1) + " 秒" : "未记录";
const versionText = (v) =>
  v
    ? Object.entries(v)
        .map(
          ([k, n]) =>
            (({
              actions: "动作",
              templates: "模板",
              foods: "食材",
              nutrition: "营养",
              ai: "模型",
            })[k] || k) +
            " v" +
            n,
        )
        .join(" / ")
    : "未记录";
const metricNames = {
  kcal: "能量",
  carb: "碳水",
  protein: "蛋白质",
  fat: "脂肪",
};
const currentConfig = (m) => {
  const c = config[m];
  return c.draft?.value
    ? JSON.parse(c.draft.value)
    : typeof c.active === "string"
      ? JSON.parse(c.active)
      : c.active;
};
const equipmentImage = (name) => {
  const d = D.dictionaries?.find((d) => d.kind === "器械" && d.name === name);
  return (
    d?.value.image || "/" + (D.equipment?.[name]?.img || "gear/free-0.jpg")
  );
};
const activityList = (events) =>
  `<ul class="activity">${
    events.length
      ? events
          .slice(0, 8)
          .map(
            (e) =>
              `<li><small>${time(e.at)}</small><p>${esc(actionNames[e.action] || e.action)}</p></li>`,
          )
          .join("")
      : "<li>尚无已记录的动态</li>"
  }</ul>`;
const actionNames = {
  sync: "同步器械与收藏",
  savePlan: "保存训练计划",
  add: "添加训练动作",
  remove: "移除训练动作",
  swap: "替换动作",
  move: "调整课程日期",
  sets: "修改组次",
  profile: "更新身体与饮食资料", profileRatios: "调整分餐比例", measurement: "记录体重", energyFeedback: "执行反馈", acceptEnergy: "接受饮食调整", cancelEnergy: "取消饮食调整", consumeMeal: "确认实际摄入", pause: "暂停计时", resume: "继续计时", workoutType: "选择活动类型",
  saveMeal: "保存餐次",
  start: "开始训练",
  finish: "完成训练",
  set: "记录实际组数",
  reorder: "调整动作顺序",
};
const safeDiff = (before, after) => {
  const keys = [
    ...new Set([...Object.keys(before || {}), ...Object.keys(after || {})]),
  ];
  return table(
    ["字段", "修改前", "修改后"],
    keys
      .filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]))
      .map((k) => [
        esc(k),
        esc(JSON.stringify(before?.[k]) ?? "未设置"),
        esc(JSON.stringify(after?.[k]) ?? "未设置"),
      ]),
  );
};

async function completeUserPage() {
  const u = user(route().id);
  if (!u) return note("用户不存在、已注销或不在授权范围");
  if (!detail[u.id]) detail[u.id] = await call("user", { id: u.id });
  const d = detail[u.id],
    t = route().params.get("tab") || "profile";
  let body = "";
  if (t === "profile") {
    const p = d.profile,
      events = d.events.filter((e) => e.action === "profile");
    body = `<div class="columns"><div>${section(
      "基础资料",
      kv([
        ["性别", p ? esc(p.sex || "未填写") : "授权后可查看"],
        ["身高", p ? numberText(p.height, " cm") : "授权后可查看"],
        ["方案体重", p ? numberText(p.weight, " kg") : "授权后可查看"],
        ["阶段目标", p ? esc(p.goal || '旧版未关联') : '授权后可查看'],
        ["饮食目标", p ? numberText(p.targets?.kcal, ' 千卡') : '授权后可查看'],
        ["维持消耗估算", p ? numberText(p.energy?.maintenance, ' 千卡') : '授权后可查看'],
        ["生效日期", p ? esc(p.effectiveFrom || '历史目标') : '授权后可查看'],
        ["计算版本", p ? numberText(p.version) : '授权后可查看'],
        ["注册来源", "微信小程序"],
        ["首次注册", time(u.created)],
        ["资料更新时间", time(events[0]?.at)],
      ]) +
        `<div class="sensitive flex between top-space"><span>${p ? "过敏原：" + esc(listText(p.allergens)) + "；忌口：" + esc(listText(p.avoid)) : "身体资料、过敏原与忌口需授权后查看，访问会留痕。"}</span>${!p && can("users.sensitive") ? btn("授权查看", "reveal-user:" + u.id) : ""}</div><div class="top-space">${note("用户资料由用户更新。后台保留更新时间与历史，不直接覆盖身体数据。") + (p ? `<details class="top-space"><summary>计算依据与历史目标</summary><pre>${esc(JSON.stringify({current:p.energy,history:d.energyHistory,pending:d.pendingEnergy,feedback:d.energyFeedback},null,2))}</pre></details>` : "")}</div>`,
    )}${section(
      "体重更新记录",
      p
        ? table(
            ["日期", "体重", "变化", "来源"],
            (Object.values(d.measurements || {}).length ? Object.values(d.measurements).sort((a,b)=>b.date.localeCompare(a.date)).map(r=>({at:r.date,after:{profile:{weight:r.weight}},before:{}})) : events).map((e) => [
              time(e.at),
              numberText(e.after.profile?.weight, " kg"),
              e.before.profile?.weight != null &&
              e.after.profile?.weight != null
                ? (e.after.profile.weight - e.before.profile.weight).toFixed(
                    1,
                  ) + " kg"
                : "首次记录",
              "用户更新",
            ]),
          )
        : note("授权后可查看已采集的体重历史。"),
    )}</div><div>${section(
      "账号摘要",
      kvList([
        ["用户 ID", esc(u.id)],
        ["账号状态", badge(u.status)],
        ["最近活跃", time(u.last)],
        ["最近同步", time(d.events.find((e) => e.action === "sync")?.at)],
        ["本地待同步", "后台无法查询"],
      ]),
    )}${section("最近动态", activityList(d.events))}</div></div>`;
  } else if (t === "gear") {
    const p = u.plans.at(-1);
    body =
      section(
        "已拥有的器械",
        `<div class="equipment">${u.prefs.owned.map((g) => `<div><img src="${esc(equipmentImage(g))}" alt="${esc(g)}"><b>${esc(g)}</b><p class="muted">已同步至账号</p></div>`).join("") || note("未同步器械，可按徒手训练。")}</div>`,
      ) +
      section(
        "训练偏好",
        kv([
          ["目标", esc(p?.goal || "未设置")],
          ["每周训练", numberText(p?.days, " 天")],
          ["每次时长", numberText(p?.minutes, " 分钟")],
          ["经验", esc(p?.input?.experience || "未记录")],
          ["本次计划器械", esc(listText(p?.gear))],
          ["器械更新时间", time(d.events.find((e) => e.action === "sync")?.at)],
        ]),
      ) +
      section(
        "器械变更记录",
        table(
          ["时间", "修改前", "修改后"],
          d.events
            .filter((e) => e.action === "sync")
            .map((e) => [
              time(e.at),
              esc(listText(e.before.prefs?.owned)),
              esc(listText(e.after.prefs?.owned)),
            ]),
        ),
      );
  } else if (t === "account") {
    body = `<div class="columns"><div>${section(
      "账号与处理记录",
      kv([
        ["账号状态", badge(u.status)],
        ["登录方式", "微信授权"],
        ["最近活跃", time(u.last)],
        ["最近同步", time(d.events.find((e) => e.action === "sync")?.at)],
        [
          "未结工单",
          d.tickets.filter((x) => !["已处理", "已驳回"].includes(x.status))
            .length,
        ],
        ["资料", "由用户自行修改"],
      ]) +
        `<div class="top-space">${note("限制后禁止新登录与写入，现有会话失效。历史业务记录保留。", true)}</div><div class="top-space">${can("users.manage") ? btn(u.status === "正常" ? "限制账号" : "恢复账号", "user-status:" + u.id) : ""}</div>`,
    )}${section(
      "反馈与注销申请",
      table(
        ["编号 / 时间", "类型", "内容", "状态", "处理人", "操作"],
        d.tickets.map((t) => [
          esc(t.id) + '<span class="sub">' + time(t.at) + "</span>",
          esc(t.kind),
          esc(t.detail),
          badge(t.status),
          esc(t.assignee || "未分派"),
          can("users.manage") && !["已处理", "已驳回"].includes(t.status)
            ? xbtn("处理", "ticket:" + t.id)
            : "—",
        ]),
      ),
    )}</div>${section(
      "内部备注",
      `<p>${esc(u.note || "暂无内部备注")}</p><div class="top-space">${btn("添加备注", "note:" + u.id)}</div>` +
        section(
          "处理时间线",
          table(
            ["时间", "操作人", "操作", "原因"],
            (D.logs || [])
              .filter(
                (l) =>
                  l.object === u.id ||
                  d.tickets.some((t) => String(t.id) === l.object),
              )
              .map((l) => [
                time(l.at),
                esc(l.actor),
                esc(l.action),
                esc(l.reason),
              ]),
          ),
        ),
    )}</div>`;
  } else {
    // Keep the same underlying list data; enrich the original detail's other tabs.
    const original = await userPage();
    const marker = original.indexOf(
      "</div>",
      original.indexOf('class="tabs plain"'),
    );
    body = original.slice(marker + 6);
  }
  return (
    title(
      "用户详情",
      "用户列表 / " + u.id,
      link("查看操作记录", "logs?object=" + u.id),
    ) +
    `<div class="user-banner"><div class="identity"><span class="avatar large">${esc(u.name[0])}</span><div><div class="flex"><h1>${esc(u.name)}</h1>${badge(u.status)}</div><div class="meta"><span class="mono">${esc(u.id)}</span><span>注册于 ${time(u.created)}</span><span>最近活跃 ${time(u.last)}</span></div></div></div><div class="mini-stats"><div><b>${u.prefs.favorites.length}</b><span>当前收藏</span></div><div><b>${u.plans.length}</b><span>周计划</span></div><div><b>${u.history.length}</b><span>完成训练</span></div></div></div>` +
    tabs(
      [
        ["profile", "基础资料"],
        ["gear", "器械与偏好"],
        ["favorites", "收藏记录"],
        ["plans", "训练计划"],
        ["meals", "饮食记录"],
        ["ai", "AI 使用"],
        ["account", "账号与处理记录"],
      ],
      "profile",
    ) +
    body
  );
}
async function completePlanPage() {
  const p = plans().find((p) => p.id === route().id);
  if (!p) return note("计划不存在或不在授权范围");
  const u = user(p.user);
  if (!detail[u.id]) detail[u.id] = await call("user", { id: u.id });
  const events = detail[u.id].events,
    t = route().params.get("tab") || "schedule";
  const initial = events
      .slice()
      .reverse()
      .find((e) => e.after.weeks?.[p.start]),
    origin = initial?.after.sessions || {},
    ids = new Set(
      Object.values(origin)
        .filter((s) => s.date >= p.start && s.date <= shift(p.start, 6))
        .map((s) => s.key),
    );
  const ss = Object.values(u.sessions).filter(
      (s) =>
        (s.date >= p.start && s.date <= shift(p.start, 6)) || ids.has(s.key),
    ),
    changes = events.filter(
      (e) =>
        JSON.stringify(e.before.sessions) !==
          JSON.stringify(e.after.sessions) &&
        Object.values({ ...e.before.sessions, ...e.after.sessions }).some(
          (s) =>
            ids.has(s.key) ||
            (s.date >= p.start && s.date <= shift(p.start, 6)),
        ),
    );
  let body = "";
  if (t === "schedule") {
    const day = route().params.get("day") || p.start,
      s = ss.find((s) => s.date === day);
    body =
      section(
        "本周安排",
        `<div class="week">${Array.from({ length: 7 }, (_, i) => {
          const date = shift(p.start, i),
            v = ss.find((x) => x.date === date);
          return `<a class="week-day ${v ? "trained" : ""} ${date === day ? "on" : ""}" href="#/plan/${p.id}?tab=schedule&day=${date}"><span>周${"一二三四五六日"[i]} · ${date.slice(8)}</span><b>${esc(v?.type || "休息")}</b>${esc(v?.status || "日常活动")}</a>`;
        }).join("")}</div>` +
          (s
            ? table(
                ["动作", "计划组次", "实际完成", "休息", "预计用时"],
                s.items.map((i) => [
                  link(i.name || move(i.id)?.name || i.id, "move/" + i.id),
                  i.sets + " 组 × " + i.target + " " + i.unit,
                  (s.actual?.[i.key] || []).length + " 组",
                  i.rest + " 秒",
                  Math.round(
                    (i.sets *
                      i.target *
                      (i.unit === "秒" ? 1 : i.seconds || 3) +
                      Math.max(0, i.sets - 1) * i.rest) /
                      60,
                  ) + " 分钟",
                ]),
              ) + `<p class="muted">课程 ID ${esc(s.key)}</p>`
            : note("当天休息，没有安排课程。")) +
          (ss.some((s) => s.date < p.start || s.date > shift(p.start, 6))
            ? section(
                "跨周调动课程",
                table(
                  ["课程 ID", "当前日期", "入口"],
                  ss
                    .filter(
                      (s) => s.date < p.start || s.date > shift(p.start, 6),
                    )
                    .map((s) => [
                      esc(s.key),
                      s.date,
                      link("查看目标周", "plans?user=" + u.id),
                    ]),
                ),
              )
            : ""),
      ) +
      note(
        "日期与组次来自用户保存的计划副本。后台仅查看，历史训练保持原始记录。",
      );
  } else if (t === "input")
    body = section(
      "生成时的条件快照",
      kv([
        ["用户", userLink(u.id)],
        ["目标", esc(p.goal)],
        ["频次 / 时长", p.days + " 天 / " + p.minutes + " 分钟"],
        ["器械", esc(listText(p.input?.gear || p.gear))],
        ["经验", esc(p.input?.experience || "未记录")],
        ["生成来源", esc(p.source) + " · 无 AI 调用"],
        ["模板与规则", esc(versionText(p.version))],
        ["保存时间", time(p.created)],
        ["首次条件", p.input ? "已保留" : "旧记录未采集"],
      ]),
    );
  else if (t === "changes")
    body =
      section(
        "计划修改记录",
        table(
          ["时间", "操作", "修改前", "修改后", "生效范围", "操作者"],
          changes.map((e) => {
            const before = Object.values(e.before.sessions || {}),
              after = Object.values(e.after.sessions || {}),
              diff = after.filter(
                (s) =>
                  JSON.stringify(before.find((x) => x.key === s.key)) !==
                  JSON.stringify(s),
              );
            return [
              time(e.at),
              esc(actionNames[e.action] || e.action),
              esc(
                before
                  .filter((s) => diff.some((x) => x.key === s.key))
                  .map(
                    (s) =>
                      s.date +
                      " " +
                      s.type +
                      " " +
                      s.items
                        .map(
                          (i) =>
                            (i.name || i.id) + " " + i.sets + "×" + i.target,
                        )
                        .join("、"),
                  )
                  .join("；") || "未安排",
              ),
              esc(
                diff
                  .map(
                    (s) =>
                      s.date +
                      " " +
                      s.type +
                      " " +
                      s.items
                        .map(
                          (i) =>
                            (i.name || i.id) + " " + i.sets + "×" + i.target,
                        )
                        .join("、"),
                  )
                  .join("；") || "课程移除",
              ),
              esc(diff.map((s) => s.key).join("、")),
              "用户",
            ];
          }),
        ),
      ) +
      section(
        "当前与初始版本",
        `<div class="diff"><div><small>首次已记录版本</small>${kv([
          ["时间", time(initial?.at)],
          [
            "课程数",
            Object.values(origin).filter((s) => ids.has(s.key)).length,
          ],
        ])}</div><div class="after"><small>当前版本</small>${kv([
          ["最近修改", time(p.at)],
          ["课程数", ss.length],
        ])}</div></div>`,
      );
  else
    body =
      ss
        .map((s) =>
          section(
            "实际训练 · " + s.date,
            kv([
              ["课程 ID", esc(s.key)],
              ["开始时间", time(s.startedAt)],
              ["结束时间", time(s.endedAt)],
              ["实际用时", duration(s.startedAt, s.endedAt)],
            ]) +
              table(
                ["动作", "计划", "实际", "重量", "状态"],
                s.items.map((i) => {
                  const actual = s.actual?.[i.key] || [];
                  return [
                    esc(i.name || move(i.id)?.name || i.id),
                    i.sets + " × " + i.target + " " + i.unit,
                    actual
                      .map(
                        (x, n) =>
                          "第" +
                          (n + 1) +
                          "组 " +
                          x.value +
                          " " +
                          (x.unit || i.unit),
                      )
                      .join("；") || "未记录",
                    actual
                      .map((x) =>
                        x.weight == null ? "未记录" : x.weight + " kg",
                      )
                      .join("；") || "未记录",
                    badge(s.status),
                  ];
                }),
              ),
          ),
        )
        .join("") || note("尚无实际训练");
  return (
    title(
      p.goal + " · " + p.days + " 天计划",
      u.name + " / " + p.id + " · " + p.start + "—" + shift(p.start, 6),
      badge(p.status),
    ) +
    summary([
      ["计划来源", p.source, "未发生 AI 费用"],
      ["每周训练", p.days + " 天", "按用户确认安排"],
      ["每次预计", p.minutes + " 分钟", "含热身、休息与转换"],
      ["已记录版本", p.revision ? "v" + p.revision : "未记录", p.modified],
    ]) +
    tabs(
      [
        ["schedule", "七天安排"],
        ["input", "生成条件"],
        ["changes", "修改记录"],
        ["actual", "实际训练"],
      ],
      "schedule",
    ) +
    body
  );
}
const mealPreview = new Map(),
  mealOptions = new Map();
async function completeMealPage() {
  const m = meals().find((m) => m.id === route().id);
  if (!m) return note("饮食记录不存在或无权限");
  if (!mealOptions.has(m.id)) {
    try {
      mealOptions.set(
        m.id,
        await complete("meal-options", { user: m.user, key: m.key }),
      );
    } catch {
      mealOptions.set(m.id, []);
    }
  }
  const g = A.generations.find((g) => g.id === m.generationId),
    preview = mealPreview.get(m.id),
    rows = m.rows || [],
    shown = preview || m;
  return (
    title(
      ["早餐", "午餐", "晚餐", "加餐"][m.index] + "搭配 · " + m.date,
      user(m.user).name + " / " + m.id + " / 已保存记录",
      g ? link("查看 AI 推荐", "generation/" + g.id) : "",
    ) +
    summary([
      ["日目标", m.dayTarget?.kcal ?? "未记录", "千卡 · 用户确认"],
      [
        "本餐目标",
        m.target?.kcal ?? "未记录",
        "千卡" + (m.ratios ? " · 全天 " + m.ratios[m.index] + "%" : ""),
      ],
      ["食材版本", "v" + m.foodsVersion, "保存时的食材快照"],
      ["计算规则", "v" + m.nutritionVersion, "推荐量取整后汇总"],
    ]) +
    `<div class="columns"><div>${section(
      "用户保存的搭配",
      table(
        ["食材", "称重口径", "重量", "碳水", "蛋白质", "脂肪"],
        rows.map((f) => [
          esc(f.name),
          esc(f.state),
          f.grams + " g" + (f.locked != null ? " · 已锁定" : ""),
          ...["carb", "protein", "fat"].map(
            (k) => ((f[k] * f.grams) / 100).toFixed(1) + " g",
          ),
        ]),
      ),
    )}${section(
      "复算预览",
      `<form id="complete-meal" data-id="${m.id}"><div class="form-grid three">${rows
        .map((f, i) => {
          const current = preview?.rows[i] || f;
          return `<div>${select(
            "食材 " + (i + 1),
            "food-" + i,
            (mealOptions.get(m.id) || []).map((x) => x.id + " · " + x.name),
            current.id + " · " + current.name,
          )}${field("锁定克数（空白自动）", "weight-" + i, current.locked ?? "", "number")}</div>`;
        })
        .join(
          "",
        )}</div><button class="btn primary top-space">重新计算</button></form><div class="top-space">${kv(Object.entries(metricNames).map(([k, n]) => [n + " / 目标", (shown.actual?.[k] ?? "未记录") + " / " + (shown.target?.[k] ?? "未记录") + (k === "kcal" ? " 千卡" : " g")]))}</div>${
        preview
          ? table(
              ["食材", "复算重量"],
              preview.rows.map((f) => [esc(f.name), f.grams + " g"]),
            )
          : ""
      }<div class="top-space">${note("复算使用保存时的目标和食材版本，并应用当前已核实的过敏原风险；不写回用户搭配。")}</div>`,
    )}</div><div>${section(
      "推荐与采用",
      kvList([
        ["AI 生成", g ? link(g.id, "generation/" + g.id) : "手动搭配 / 未关联"],
        ["最终食材", esc(rows.map((r) => r.name).join("、"))],
        [
          "用户锁定",
          esc(
            rows
              .filter((r) => r.locked != null)
              .map((r) => r.name + " " + r.locked + " g")
              .join("、") || "无",
          ),
        ],
        ["采用状态", g ? badge(g.adoption) : "无 AI 关联"],
        ["保存时间", time(m.savedAt)],
      ]),
    )}${section("当前营养差额", kvList(Object.entries(metricNames).map(([k, n]) => [n, shown.delta?.[k] === 0 ? "达到目标" : (shown.delta?.[k] > 0 ? "还差 " : "超出 ") + numberText(Math.abs(shown.delta?.[k]), k === "kcal" ? " 千卡" : " g")])))}${section("搭配历史", xbtn("查看保存版本", "meal-history:" + m.id))}</div></div>`
  );
}
async function completeMovePage() {
  const m = move(route().id);
  if (!m) return note("动作不存在");
  const v = m.draft || m,
    t = route().params.get("tab") || "info";
  if (t !== "info") return movePage();
  const refs = (D.users || []).flatMap((u) =>
      Object.values(u.sessions)
        .filter((s) => s.items.some((i) => move(i.id)?.id === m.id))
        .map((s) => ({ u, s })),
    ),
    media = v.media || {};
  return (
    title(
      m.name,
      "全部动作 / " + m.id + " · " + m.part + " / " + m.muscle,
      (can("content.publish")
        ? btn(m.visible ? "下架动作" : "重新上架", "move-toggle:" + m.id)
        : "") +
        xbtn("保存草稿", "submit-move") +
        (m.draft && can("content.edit")
          ? btn("提交审核", "move-submit:" + m.id, "primary")
          : ""),
    ) +
    tabs(
      [
        ["info", "资料与素材"],
        ["scheduling", "排课属性"],
        ["usage", "使用与引用"],
        ["versions", "版本与发布"],
      ],
      "info",
    ) +
    `<div class="columns wide-left"><div>${section("演示与原版对照", `<div class="media-pair"><div><div class="caption">原版参考 · ${esc(v.source || "项目原始素材")}</div><div class="frame"><img src="${esc(m.id.startsWith("N") ? media.cover || "/brand.svg" : "/media/original/" + m.id)}" alt="原版参考"></div>${btn("暂停 / 播放原版", "motion:original", "text-btn")}</div><div><div class="caption">当前重制动图</div><div class="frame"><img src="${esc(media.animation || "/media/new/" + m.id)}" alt="当前动图"></div>${btn("暂停 / 播放演示", "motion:new", "text-btn")}</div></div><details class="media-options"><summary>素材信息与替换</summary><div class="media-status muted">打开后可核对尺寸与加载状态。</div><p class="muted">并排预览不保证逐帧同步。</p><form id="media-form" data-id="${m.id}" class="top-space"><div class="form-grid"><label class="field">封面 WebP<input type="file" name="cover" accept="image/webp"></label><label class="field">动图 WebP<input type="file" name="animation" accept="image/webp"></label></div><button class="btn top-space">保存素材草稿</button></form></details>`)}${section("名称与动作说明", `<form id="complete-move" data-id="${m.id}"><div class="form-grid">${field("动作名称", "name", v.name)}${field("稳定动作 ID", "id", m.id).replace("<input ", "<input readonly ")}</div><div class="top-space">${field("当前说明（每行一步）", "steps", v.steps.join("\n"), "textarea")}</div><details class="top-space"><summary>分类、器械与扩展资料</summary><div class="form-grid top-space">${field("原始名称", "originalName", v.originalName || m.name)}${field("别名（逗号分隔）", "aliases", listText(v.aliases) === "未填写" ? "" : v.aliases.join(","))}${field("训练部位", "part", v.part)}${field("目标肌群", "muscle", v.muscle)}${field("辅助肌群（逗号分隔）", "secondaryMuscles", (v.secondaryMuscles || []).join(","))}${select("动作类型", "warmup", ["正式动作", "热身"], v.warmup ? "热身" : "正式动作")}${field("必需器械（全部满足）", "gear", v.gear.join(","))}${field("可选器械（不影响必需条件）", "optionalGear", (v.optionalGear || []).join(","))}</div></details><div class="top-space">${field("动作要点", "tips", (v.tips || []).join("\n"), "textarea")}${field("来源说明", "source", v.source || "")}${field("修改原因", "reason", "", "textarea")}</div><button class="btn primary">保存草稿</button></form><details class="top-space"><summary>原始介绍与替代关系</summary><p>${esc(v.originalDescription || m.steps.join("；"))}</p>${kv(Object.entries(v.alternatives || {}).map(([k, x]) => [k, esc(listText(x))]))}${xbtn("维护器械替代关系", "alternatives:" + m.id)}</details>`)}</div><div>${section(
      "分类与状态",
      kvList([
        ["部位", esc(v.part)],
        ["目标肌群", esc(v.muscle)],
        ["动作类型", v.warmup ? "热身" : "正式动作"],
        ["浏览状态", badge(m.visible ? "已上架" : "已下架")],
        ["内容状态", badge(m.status)],
        ["版本", "v" + m.version],
      ]),
    )}${section("必需器械", `<div class="chips">${v.gear.map((g) => `<span class="chip">${esc(g)}</span>`).join("") || "徒手"}</div><p class="muted top-space">组合关系：全部满足。器械替代关系另行登记。</p>`)}${section(
      "使用与引用",
      kvList([
        [
          "当前收藏人数",
          favorites().filter((f) => move(f.move)?.id === m.id).length,
        ],
        ["未完成课程", refs.filter((x) => x.s.status !== "已完成").length],
        [
          "历史训练",
          (D.users || []).reduce(
            (n, u) =>
              n +
              u.history.filter((h) =>
                h.items.some((i) => move(i.id)?.id === m.id),
              ).length,
            0,
          ),
        ],
        ["修改人", esc(m.by || "未记录")],
        ["最后修改", time(m.at)],
      ]),
    )}${m.id.startsWith("N") && !m.version ? section("草稿管理", xbtn("删除未发布草稿", "delete-move:" + m.id)) : ""}</div></div>`
  );
}

function completeTaxonomyPage() {
  const kind = route().params.get("tab") || "部位",
    items =
      kind === "器械"
        ? Object.keys(D.equipment || {})
        : [
            ...new Set(
              (D.moves || []).map((m) => (kind === "部位" ? m.part : m.muscle)),
            ),
          ];
  for (const d of D.dictionaries || [])
    if (d.kind === kind && !items.includes(d.name)) items.push(d.name);
  const rows = filtered(
    items
      .map((name) => ({
        name,
        ...(D.dictionaries || []).find(
          (d) => d.kind === kind && d.name === name,
        ),
      }))
      .sort((a, b) => (a.value?.order || 0) - (b.value?.order || 0)),
    (d) => d.name + (d.value?.aliases || []).join(""),
  );
  return (
    title(
      "部位、肌群与器械",
      "统一维护分类、名称、参考图与动作关联。",
      can("content.edit") ? xbtn("新增条目", "taxonomy:", "primary") : "",
    ) +
    tabs(
      [
        ["部位", "训练部位"],
        ["肌群", "目标肌群"],
        ["器械", "器械目录"],
      ],
      "部位",
    ) +
    `<section class="section">${filters([], "搜索分类或器械名称")}${page(rows, ["名称", "分组 / 别名", "关联动作", "状态", "排序", "操作"], (d) => [`<div class="cell-media">${kind === "器械" || d.value?.image ? `<img class="thumb" src="${esc(d.value?.image || equipmentImage(d.name))}" alt="${esc(d.name)}">` : ""}${esc(d.name)}</div>`, esc(d.value?.group || D.equipment?.[d.name]?.group || "") + '<span class="sub">' + esc((d.value?.aliases || []).join("、")) + "</span>", link(D.moves.filter((m) => (kind === "器械" ? m.gear.includes(d.name) : kind === "部位" ? m.part === d.name : m.muscle === d.name)).length, "moves?" + { 器械: "gear", 部位: "part", 肌群: "muscle" }[kind] + "=" + encodeURIComponent(d.name)), badge(d.value?.enabled === false ? "已停用" : "启用"), d.value?.order || 0, can("content.edit") ? xbtn("编辑", "taxonomy:" + d.name, "text-btn") : "—"])}</section>`
  );
}
function completeStaffPage() {
  const rows = filtered(
    D.staff || [],
    (s) => s.name + s.display + s.roles.join(""),
    {
      enabled: (s) => (s.enabled ? "启用" : "已停用"),
      role: (s) =>
        s.roles.includes(filtersState.staff?.role)
          ? filtersState.staff.role
          : "",
    },
  );
  return (
    title(
      "管理人员",
      "每位管理员使用独立账号；停用不删除历史身份。",
      btn("新建管理员", "staff-new", "primary"),
    ) +
    summary([
      ["管理账号", D.staff.length, "独立身份"],
      ["已启用", D.staff.filter((s) => s.enabled).length, "可登录后台"],
      ["角色数量", D.roleDefs.length, "支持多角色授权"],
      ["已停用", D.staff.filter((s) => !s.enabled).length, "保留操作记录"],
    ]) +
    `<section class="section">${filters(
      [
        ["role", "全部角色", D.roleDefs.map((r) => r.name)],
        ["enabled", "全部状态", ["启用", "已停用"]],
      ],
      "搜索姓名、账号",
    )}${page(rows, ["管理员", "登录账号", "角色", "数据范围", "状态", "最近登录", "操作"], (s) => [`<div class="identity"><span class="avatar">${esc(s.display[0])}</span><div>${link(s.display, "staffdetail/" + s.name)}<span class="sub">${esc(s.name)}</span></div></div>`, esc(s.name), esc(s.roles.join("、")), esc(s.scope.users === "all" ? "全部用户" : s.scope.users === "assigned" ? "关联个案" : s.scope.users.length + " 位指定用户"), badge(s.enabled ? "启用" : "已停用"), time(s.last), btn("编辑", "staff-edit:" + s.name, "text-btn") + btn(s.enabled ? "停用" : "启用", "staff-state:" + s.name, "text-btn")])}</section>`
  );
}
function staffDetailPage() {
  if (!can("admin.manage")) return note("无管理员详情权限");
  const s = D.staff.find((s) => s.name === route().id);
  if (!s) return note("管理员不存在");
  const permissions = [
      ...new Set(
        s.roles.flatMap(
          (r) => D.roleDefs.find((x) => x.name === r)?.permissions || [],
        ),
      ),
    ],
    logs = (D.logs || []).filter((l) => l.actor === "op:" + s.name);
  return (
    title(
      "管理员 · " + s.display,
      "管理人员 / " + s.name,
      btn("编辑账号", "staff-edit:" + s.name) +
        btn("强制退出", "staff-logout:" + s.name),
    ) +
    section(
      "账号与有效权限",
      kv([
        ["登录账号", esc(s.name)],
        ["角色", esc(s.roles.join("、"))],
        ["启用状态", badge(s.enabled ? "启用" : "已停用")],
        [
          "用户范围",
          esc(
            s.scope.users === "all"
              ? "全部用户"
              : s.scope.users === "assigned"
                ? "关联个案"
                : s.scope.users.join("、"),
          ),
        ],
        [
          "环境 / 场景",
          esc(
            s.scope.environment +
              " / " +
              (s.scope.scenes.join("、") || "全部场景"),
          ),
        ],
        ["最近登录", time(s.last)],
        ["创建人", esc(s.creator || "未记录")],
        ["创建时间", time(s.created)],
      ]) +
        `<div class="chips top-space">${permissions.map((k) => `<span class="chip">${esc(permissionLabels[k])}</span>`).join("")}</div>`,
    ) +
    section("最近操作", auditTable(logs)) +
    section(
      "授权变更",
      auditTable(
        (D.logs || []).filter(
          (l) => l.object === s.name || s.roles.includes(l.object),
        ),
      ),
    )
  );
}
function auditTable(rows) {
  return table(
    ["时间 / 日志 ID", "操作人", "操作", "对象", "结果", ""],
    rows.map((l) => [
      time(l.at) + '<span class="sub mono">' + esc(l.id) + "</span>",
      esc(l.actor),
      esc(l.action),
      esc(l.object),
      badge(l.result),
      btn("查看差异", "log:" + l.id, "text-btn"),
    ]),
  );
}
function completeLogsPage() {
  const object = route().params.get("object"),
    rows = filtered(
      (D.logs || []).filter((l) => !object || l.object === object),
      (l) => l.id + l.actor + l.object + l.action + l.reason,
      {
        actor: (l) => l.actor,
        result: (l) => l.result,
        role: (l) =>
          l.roles.includes(filtersState.logs?.role)
            ? filtersState.logs.role
            : "",
      },
    );
  return (
    title("操作日志", "记录谁在何时，对哪个对象执行了什么操作。") +
    `<section class="section">${filters([
      ["actor", "全部管理员", [...new Set((D.logs || []).map((l) => l.actor))]],
      [
        "role",
        "全部角色",
        [...new Set((D.logs || []).flatMap((l) => l.roles))],
      ],
      ["result", "全部结果", ["成功", "失败", "拒绝", "部分成功"]],
    ])}${object ? note("对象范围：" + object) : ""}${auditTable(rows)}</section>` +
    note(
      "普通日志展示脱敏差异，不保存明文密码、模型密钥或完整身体资料。日志不提供编辑和删除操作。",
    )
  );
}

function generationCalls(cs) {
  return table(
    ["调用", "结果", "耗时", "费用", "计费状态"],
    cs.map((c) => [
      link(c.id, "call/" + c.id) +
        '<span class="sub">第 ' +
        c.seq +
        " 次 · " +
        time(c.at) +
        "</span>",
      badge(c.result),
      duration(c.at, c.ended),
      costCell([c]),
      badge(c.billing),
    ]),
  );
}
function completeGenerationPage() {
  const g = A.generations.find((g) => g.id === route().id);
  if (!g) return note("生成不存在或无权限");
  const cs = callsOf(g.id).sort((a, b) => a.seq - b.seq),
    p = prices(cs),
    t = route().params.get("tab") || "overview",
    meal = meals().find((m) => m.generationId === g.id);
  let body = "";
  if (t === "overview")
    body = `<div class="columns"><div>${section(
      "生成概况",
      kv([
        ["业务场景", esc(g.scene)],
        [
          "触发来源",
          g.environment === "test"
            ? "后台测试"
            : g.parent
              ? "用户重新生成"
              : "用户首次生成",
        ],
        ["业务结果", badge(g.status)],
        ["模型 / 版本", esc(g.config.model)],
        ["提示词版本", "v" + g.config.version],
        ["生成时间", time(g.at)],
        ["关联用户", userLink(g.user)],
        ["实际调用", cs.length + " 次"],
        ["用户采用", badge(g.adoption)],
      ]),
    )}${section("调用过程", generationCalls(cs))}</div><div>${section(
      "关联记录",
      kvList([
        ["用户", userLink(g.user)],
        [
          "餐次记录",
          meal ? link(meal.id, "meal/" + meal.id) : "未保存 / 未关联",
        ],
        ["用户计划", "本次不涉及"],
        [
          "原生成",
          g.parent ? link(g.parent, "generation/" + g.parent) : "首次生成",
        ],
      ]),
    )}${section("处理摘要", `<ul class="activity">${cs.map((c) => `<li><small>${time(c.at)} · 第 ${c.seq} 次调用</small><p>${esc(c.error || c.result)}</p><span class="sub">${esc(c.model)} · ${duration(c.at, c.ended)}</span></li>`).join("")}<li><small>业务处理结果</small><p>${esc(g.error || g.status)}</p></li></ul>`)}</div></div>`;
  else if (t === "input" || t === "output") {
    const d = detail[g.id];
    body = section(
      t === "input" ? "输入快照" : "输出与校验",
      d
        ? t === "input"
          ? kv([
              ["餐次", esc(d.input?.meal || "未记录")],
              ["口味提示", esc(d.input?.taste || "无")],
              ["限制", esc(listText(d.input?.restrictions?.allergens))],
              [
                "候选编号",
                esc(
                  d.input?.candidates?.map((c) => c.id).join("、") || "未记录",
                ),
              ],
            ]) + section("当时模型参数", pre(g.config))
          : (d.payloads || [])
              .map((x) =>
                section(
                  x.call_id,
                  kv([
                    ["校验", esc(x.validation)],
                    ["模型返回", esc(x.response?.content || "未记录")],
                  ]),
                ),
              )
              .join("") +
            section(
              "最终交付内容",
              d.output?.items
                ? table(
                    ["食材编号", "推荐原因"],
                    d.output.items.map((x) => [esc(x.id), esc(x.reason)]),
                  )
                : note(d.output?.reason || "历史记录未保存输出"),
            )
        : note("详细输入与输出单独授权，访问原因会被记录。") +
            (can("ai.sensitive") ? btn("授权查看", "reveal-ai:" + g.id) : ""),
    );
  } else if (t === "calls") body = section("调用时间线", generationCalls(cs));
  else
    body = section(
      "用户后续行为",
      kv([
        ["采用情况", badge(g.adoption)],
        [
          "保存对象",
          meal
            ? link(meal.id, "meal/" + meal.id)
            : esc(g.object || "未保存 / 未关联"),
        ],
        ["保存时间", time(meal?.savedAt)],
        [
          "已保存食材",
          esc(meal?.rows?.map((r) => r.name).join("、") || "尚无已保存搭配"),
        ],
      ]),
    );
  return (
    title(
      "生成详情 · " + g.id,
      g.scene + " / " + time(g.at),
      can("ai.test") ? btn("重放为测试请求", "replay:" + g.id) : "",
    ) +
    (can("ai.cost")
      ? `<div class="price-hero"><div><small>本次生成费用 · 含待确认估算</small><div class="value">${money(p.confirmed + p.pending)}</div><small>${cs.length} 次调用合计${p.unknown ? " · " + p.unknown + " 笔未知" : ""}</small></div><div><small>账单已确认</small><div class="value">${money(p.confirmed)}</div><small>包含关联退款与调整</small></div><div><small>待确认估算</small><div class="value orange">${money(p.pending)}</div><small>按当次价格版本计算</small></div></div>`
      : "") +
    tabs(
      [
        ["overview", "概况"],
        ["input", "输入快照"],
        ["output", "输出与校验"],
        ["calls", "调用时间线"],
        ["adoption", "用户后续行为"],
      ],
      "overview",
    ) +
    body
  );
}
function billsTable(bs) {
  return table(
    ["账单行 / 周期", "原币 / 汇率", "人民币金额", "来源 / 日期", "操作"],
    bs.map((b) => [
      esc(b.id) + '<span class="sub">' + esc(b.period) + "</span>",
      esc(b.original + " " + b.currency) +
        '<span class="sub">汇率 ' +
        esc(b.rate) +
        " · " +
        esc(b.rate_date || "未记录") +
        "</span>",
      money(b.amount),
      esc(b.source) + '<span class="sub">' + time(b.at) + "</span>",
      xbtn("退款 / 调整", "adjust:" + b.id, "text-btn"),
    ]),
  );
}
function adjustmentsTable(bs) {
  const ids = new Set(bs.map((b) => b.id));
  return table(
    [
      "调整 ID",
      "原账单",
      "类型",
      "原币",
      "人民币变动",
      "依据 / 原因",
      "处理人",
    ],
    (A.adjustments || [])
      .filter((a) => ids.has(a.bill))
      .map((a) => [
        esc(a.id),
        esc(a.bill),
        esc(a.kind),
        esc(a.original + " " + a.currency),
        money(a.amount),
        esc(a.source + " / " + a.reason),
        esc(a.actor),
      ]),
  );
}
function completeCallPage() {
  if (!can("ai.cost")) return note("无费用查看权限");
  const c = A.calls.find((c) => c.id === route().id);
  if (!c) return note("调用不存在或无权限");
  const g = A.generations.find((g) => g.id === c.generation),
    p = c.price || {},
    u = c.usage,
    bs = A.bills.filter((b) => b.call_id === c.id),
    lines = [
      [
        "普通输入",
        u ? u.prompt_tokens - (u.prompt_cache_hit_tokens || 0) : null,
        p.pricePerMillionInput,
      ],
      [
        "缓存命中",
        u?.prompt_cache_hit_tokens,
        p.pricePerMillionCache ?? p.pricePerMillionInput,
      ],
      ["输出", u?.completion_tokens, p.pricePerMillionOutput],
    ];
  return (
    title(
      "调用详情 · " + c.id,
      "第 " + c.seq + " 次调用 · " + g.scene,
      badge(c.billing),
    ) +
    `<div class="columns"><div>${section(
      "本次计费明细",
      `<div class="flex between"><div><p class="muted">${c.confirmed == null ? "待确认估算" : "账单确认净费用"}</p><h1 class="money blue price-large">${money(c.confirmed ?? c.estimate)}</h1></div><div>${badge(c.result)}<p class="muted">人民币 CNY · ${duration(c.at, c.ended)}</p></div></div>` +
        table(
          ["计费项目", "用量", "当次单价", "金额"],
          lines.map(([n, q, price]) => [
            n,
            q == null ? "未提供" : q + " Token",
            price == null ? "旧记录未保留" : "¥" + price + " / 百万 Token",
            q == null || price == null
              ? "待回补"
              : money((q * price) / 1000000),
          ]),
        ) +
        `<div class="top-space">${note("缓存命中从总输入中拆分，避免重复计费。未回补的费用不会显示为免费。")}</div>`,
    )}${section(
      "账单与价格依据",
      kv([
        ["计费状态", badge(c.billing)],
        ["服务商请求 ID", esc(c.provider_id || "未返回")],
        ["服务商", "DeepSeek"],
        ["价格版本", "v" + (g.config.version ?? "未记录")],
        ["价格币种", esc(p.currency || "历史未记录")],
        ["原始估算", money(c.estimate)],
        ["账单净额", c.confirmed == null ? "未确认" : money(c.confirmed)],
        [
          "账单与估算差额",
          c.confirmed == null || c.estimate == null
            ? "待核对"
            : money(Number(c.confirmed) - Number(c.estimate)),
        ],
        ["预留额度", money(c.reserve)],
      ]) +
        `<div class="actions top-space">${xbtn("关联本次账单", "bill:" + c.id)}${btn("回补用量", "usage:" + c.id)}</div>`,
    )}${section("关联账单", billsTable(bs))}${section("退款与账单调整", adjustmentsTable(bs))}</div><div>${section(
      "关联与调用信息",
      kvList([
        ["业务生成", link(g.id, "generation/" + g.id)],
        ["用户", userLink(g.user)],
        ["模型", esc(c.model)],
        ["提示词", "v" + g.config.version],
        ["开始时间", time(c.at)],
        ["结束时间", time(c.ended)],
        ["重试序号", c.seq - 1],
        ["调用结果", badge(c.result)],
        ["错误原因", esc(c.error || "无")],
      ]),
    )}${section("计费时间线", activityList([{ at: c.at, action: "调用记录建立，请求发出" }, ...(c.ended ? [{ at: c.ended, action: c.usage ? "已返回用量，计算估算金额" : "用量待回补" }] : []), ...bs.map((b) => ({ at: b.at, action: "关联服务商账单" }))]))}</div></div>`
  );
}

async function completeConfigPage() {
  const keyStatus=await api("admin/ai-status");
  if (!config.ai) config.ai = await api("admin/inspect", { module: "ai" });
  const c = config.ai,
    v = currentConfig("ai"),
    t = route().params.get("tab") || "model";
  let fields = "";
  if (t === "model")
    fields = `<div class="form-grid">${field("服务商", "provider", "DeepSeek").replace("<input ", "<input readonly ")}${select("默认模型", "model", ["deepseek-flash", "deepseek-v4-pro"], v.model)}${select("启用状态", "enabled", ["启用", "停用"], v.enabled === false ? "停用" : "启用")}${field("最大重试次数", "maxRetries", v.maxRetries || 0, "number")}${field("请求超时 · 毫秒", "timeoutMs", v.timeoutMs || 12000, "number")}${select("备用模型", "fallbackModel", ["", "deepseek-flash", "deepseek-v4-pro"], v.fallbackModel || "")}</div>`;
  if (t === "prompt")
    fields =
      field("提示词", "prompt", v.prompt, "textarea") +
      `<div class="form-grid">${field("输入 Token 上限", "maxInputTokens", v.maxInputTokens || 8192, "number")}${field("输出 Token 上限", "maxOutputTokens", v.maxOutputTokens || 2048, "number")}</div>` +
      note("只保存可交付内容，不保存模型内部思考过程。");
  if (t === "price" && !can("ai.cost")) return note("当前账号无单价查看权限");
  if (t === "price")
    fields =
      `<div class="form-grid">${[
        ["普通输入 / 百万 Token", "pricePerMillionInput"],
        ["输出 / 百万 Token", "pricePerMillionOutput"],
        ["缓存命中 / 百万 Token", "pricePerMillionCache"],
        ["备用模型输入 / 百万 Token", "fallbackInput"],
        ["备用模型输出 / 百万 Token", "fallbackOutput"],
        ["备用模型缓存 / 百万 Token", "fallbackCache"],
      ]
        .map(([n, k]) => field(n + "（人民币元）", k, v[k] ?? "", "number"))
        .join("")}</div>` +
      note("新价格发布后只影响新调用，旧估算保留原价格快照。");
  if (t === "budget")
    fields =
      `<div class="form-grid">${field("每日调用上限", "dailyLimit", v.dailyLimit, "number")}${field("每用户每日上限", "userDailyLimit", v.userDailyLimit ?? v.dailyLimit, "number")}${field("每日预算（留空不设金额限制）", "dailyBudget", v.dailyBudget ?? "", "number")}</div>` +
      note(
        "进行中的调用预留预算计入上限；最大重试与备用模型调用都需重新取得预算。失败最终回退至手动搭配。",
      );
  return (
    title(
      "模型与生成配置",
      "模型、提示词、价格与预算按版本管理。",
      xbtn("保存配置草稿", "submit-ai") +
        (c.draft ? btn("提交审核", "module-submit:ai", "primary") : ""),
    ) +
    tabs(
      [
        ["model", "服务商与模型"],
        ["prompt", "提示词版本"],
        ["price", "单价与计费"],
        ["budget", "预算与回退"],
      ],
      "model",
    ) +
    `<div class="columns"><div>${section({ model: "模型与服务商", prompt: "提示词", price: "价格版本", budget: "预算与回退" }[t], `<form id="complete-ai">${fields}<button class="btn primary top-space">保存草稿</button></form>` + `<div class="top-space">${btn("使用固定条件试算", "trial:ai")}</div>`)}${section(
      "审核与版本",
      note("当前 v" + c.version + " · " + (c.draft?.status || "无草稿")) +
        `<div class="actions top-space">${c.draft?.status === "待审核" ? btn("批准发布", "module-publish:ai", "primary") + btn("退回修改", "module-reject:ai") : ""}</div>` +
        table(
          ["版本", "操作"],
          (c.history || []).map((n) => [
            "v" + n,
            xbtn("查看版本", "version:ai:" + n) +
              btn("回退", "module-rollback:ai:" + n),
          ]),
        ),
    )}</div>${section(
      "服务端凭据",
      kvList([
        ["服务商", "DeepSeek"],
        ["凭据标识", "服务端加密保存"],
        ["当前状态", keyStatus.configured?(keyStatus.disabled?"已配置 · 已停用":"已配置 · 已启用"):"未配置"],
      ]) +
        xbtn("查询配置状态", "key-status") +
        `<div class="actions top-space">${can("ai.credentials") ? btn("轮换凭据", "key") + xbtn("停用 / 启用", "key-state") : ""}</div>` +
        note("仅展示配置状态，密钥不回显或写入日志。"),
    )}</div>`
  );
}

Object.assign(views, {
  user: completeUserPage,
  plan: completePlanPage,
  meal: completeMealPage,
  move: completeMovePage,
  taxonomy: completeTaxonomyPage,
  staff: completeStaffPage,
  staffdetail: staffDetailPage,
  logs: completeLogsPage,
  generation: completeGenerationPage,
  call: completeCallPage,
  config: completeConfigPage,
});

const uploadWebp = async (file) => {
  if (!file?.size) return null;
  if (file.size > 4 * 1024 * 1024) throw Error("图片不得超过4MB");
  const data = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  return call("media-upload", { data });
};
const fxFields = () =>
  `<div class="form-grid">${select("原币", "currency", ["CNY", "USD", "EUR", "HKD", "JPY"], "CNY")}${field("原币金额", "amount", "", "number")}${field("换算汇率（每1原币对应人民币）", "rate", "1", "number")}${field("汇率日期", "rateDate", new Date().toISOString().slice(0, 10), "date")}${field("汇率来源（外币必填）", "rateSource")}${field("账单 / 调整来源", "source")}</div>`;
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-complete]");
  if (!el) return;
  const [action, ...rest] = el.dataset.complete.split(":"),
    v = rest.join(":");
  try {
    if (action === "submit-move") {
      $("#complete-move").requestSubmit();
      return;
    }
    if (action === "submit-ai") {
      $("#complete-ai").requestSubmit();
      return;
    }
    if (action === "taxonomy") {
      const kind = route().params.get("tab") || "部位",
        d = D.dictionaries?.find((d) => d.kind === kind && d.name === v),
        val = d?.value || {};
      modal(
        "维护" + kind,
        (v
          ? field("名称", "name", v).replace("<input ", "<input readonly ")
          : field("名称", "name")) +
          field("别名（逗号分隔）", "aliases", (val.aliases || []).join(",")) +
          `<div class="form-grid">${field("分组", "group", val.group || D.equipment?.[v]?.group || "")}${field("排序", "order", val.order || 0, "number")}${select("状态", "enabled", ["启用", "停用"], val.enabled === false ? "停用" : "启用")}</div><label class="field">参考图 WebP<input type="file" name="image" accept="image/webp"></label>${val.image ? `<img class="thumb" src="${esc(val.image)}" alt="当前参考图">` : ""}` +
          field("修改原因", "reason"),
        async (f) => {
          const media = await uploadWebp(f.get("image"));
          await call("taxonomy-save", {
            kind,
            name: v || f.get("name").trim(),
            base: d?.version || 0,
            value: {
              ...val,
              aliases: f.get("aliases").split(",").filter(Boolean),
              group: f.get("group"),
              order: Number(f.get("order")),
              enabled: f.get("enabled") === "启用",
              image: media ? media.url : val.image,
            },
            reason: f.get("reason"),
          });
          await refresh();
        },
      );
      return;
    }
    if (action === "ticket") {
      const u = user(route().id),
        t = detail[u.id].tickets.find((t) => String(t.id) === v);
      modal(
        "处理工单 " + v,
        note(
          t.kind === "注销"
            ? "注销将清理该账号个人数据与会话，保留脱敏费用和操作记录。请核对申请及原因。"
            : "处理结果、处理人和原因将保留在工单日志。",
          t.kind === "注销",
        ) +
          kv([
            ["类型", esc(t.kind)],
            ["申请内容", esc(t.detail)],
          ]) +
          select(
            "处理方式",
            "operation",
            t.kind === "注销"
              ? ["分派", "驳回", "注销"]
              : ["处理", "分派", "驳回"],
          ) +
          field("分派账号", "assignee", t.assignee || "") +
          (t.kind === "注销"
            ? field("注销时输入工单编号确认", "confirm")
            : "") +
          field("处理原因", "reason", "", "textarea"),
        async (f) => {
          await complete("ticket", {
            id: t.id,
            operation: f.get("operation"),
            assignee: f.get("assignee"),
            confirm: f.get("confirm"),
            reason: f.get("reason"),
          });
          await refresh();
          if (f.get("operation") === "注销") location.hash = "/users";
        },
      );
      return;
    }
    if (
      action === "bill" ||
      action === "period-bill" ||
      action === "adjust" ||
      action === "funding"
    ) {
      const adjustment = action === "adjust",
        funding = action === "funding";
      modal(
        adjustment
          ? "退款 / 账单调整"
          : funding
            ? "登记资金资料"
            : action === "bill"
              ? "关联本次调用账单"
              : "登记独立周期账单",
        note(
          funding
            ? "这里只登记资料，不执行充值，不计入调用消耗。"
            : adjustment
              ? "关联原账单，保留原金额及每次调整，不覆盖历史估算。"
              : "只有可归属请求的账单才能确认单次费用；周期总额独立登记。",
        ) +
          (adjustment
            ? field("调整编号", "adjustmentId") +
              select("调整类型", "kind", ["退款", "调减", "调增"])
            : funding
              ? field("资料编号", "entryId") +
                select("资料类型", "kind", ["充值", "余额快照", "购买额度"])
              : field("账单行编号", "billId") +
                field(
                  "账单周期",
                  "period",
                  new Date().toISOString().slice(0, 7),
                )) +
          fxFields() +
          field("核对原因", "reason", "", "textarea"),
        async (f) => {
          const b = Object.fromEntries(f);
          if (adjustment) {
            b.billId = v;
            await ledger("adjustment", b);
          } else if (funding) await ledger("funding", b);
          else await ledger(action, { ...b, id: v });
          await refresh();
        },
      );
      return;
    }
    if (action === "version") {
      const [module, version] = rest;
      const r = await api("admin/version", {
        module,
        version: Number(version),
      });
      modal("历史版本 · " + module + " v" + version, pre(r));
      return;
    }
    if (action === "key-status") {
      const s = await api("admin/ai-status");
      modal(
        "凭据配置状态",
        kv([
          ["API Key", s.configured ? "已配置" : "未配置"],
          ["启用状态", s.disabled ? "已停用" : "启用"],
        ]),
      );
      return;
    }
    if (action === "key-state") {
      modal(
        "停用 / 启用 AI 凭据",
        select("目标状态", "enabled", ["停用", "启用"]) +
          field("原因", "reason"),
        async (f) => {
          await api("admin/key-state", {
            enabled: f.get("enabled") === "启用",
            reason: f.get("reason"),
          });
          toast("凭据状态已更新");
        },
      );
      return;
    }
    if (action === "meal-history") {
      const m = meals().find((m) => m.id === v);
      const d = await call("user", { id: m.user });
      modal(
        "餐次保存历史",
        table(
          ["时间", "食材", "目标", "版本"],
          d.events
            .filter(
              (e) =>
                e.action === "saveMeal" &&
                JSON.stringify(e.before.meals?.[m.key]) !==
                  JSON.stringify(e.after.meals?.[m.key]),
            )
            .map((e) => {
              const a = e.after.meals[m.key];
              return [
                time(e.at),
                esc(
                  a.rows.map((x) => x.name + " " + x.grams + " g").join("、"),
                ),
                a.target.kcal + " 千卡",
                "食材 v" + a.foodsVersion + " / 营养 v" + a.nutritionVersion,
              ];
            }),
        ),
      );
      return;
    }
    if (action === "alternatives") {
      const m = move(v),
        value = m.draft || m;
      modal(
        "器械替代关系",
        note("每行一个原器械；同一行填写任一可替代器械，用逗号分隔。") +
          value.gear
            .map((g) => field(g, g, (value.alternatives?.[g] || []).join(",")))
            .join(""),
        async (f) => {
          const alternatives = Object.fromEntries(
            [...f].map(([k, v]) => [
              k,
              v
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            ]),
          );
          await call("move-draft", {
            id: m.id,
            base: m.version,
            value: { ...value, alternatives },
          });
          await refresh();
        },
      );
      return;
    }
    if (action === "delete-move") {
      confirm(
        "删除尚未发布的动作草稿",
        note("仅允许删除未发布且无用户引用的草稿。", true),
        async (reason) => {
          await call("move-delete", { id: v, reason });
          await refresh();
          location.hash = "/moves";
        },
      );
      return;
    }
    if (action === "batch") {
      const ids = [...selected];
      if (!ids.length) throw Error("请先选择动作");
      modal(
        "批量维护 " + ids.length + " 个动作",
        note("保存为草稿，逐条审核发布后才对小程序生效。") +
          select("操作", "kind", ["分类", "标签", "排课资格", "上架", "下架"]) +
          field("训练部位", "part") +
          field("目标肌群", "muscle") +
          field("标签（逗号分隔）", "tags") +
          select("自动排课", "enabled", ["启用", "停用"]) +
          field("原因", "reason"),
        async (f) => {
          const kind = f.get("kind"),
            b = {
              ids,
              kind,
              part: f.get("part"),
              muscle: f.get("muscle"),
              tags: f.get("tags").split(",").filter(Boolean),
              enabled: f.get("enabled") === "启用",
              reason: f.get("reason"),
            };
          const r = ["上架", "下架"].includes(kind)
            ? await call("move-bulk", {
                ids,
                visible: kind === "上架",
                reason: b.reason,
              })
            : await complete("move-batch", b);
          selected.clear();
          await refresh();
          modal(
            "逐条处理结果",
            table(
              ["动作", "结果"],
              r.results.map((x) => [esc(x.id), x.ok ? "成功" : esc(x.error)]),
            ),
          );
        },
      );
      return;
    }
  } catch (err) {
    toast(err.message);
  }
});
document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (
    !["complete-move", "complete-ai", "complete-meal"].includes(
      form.getAttribute("id"),
    )
  )
    return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const f = new FormData(form),
    button = form.querySelector("button[type=submit],button:not([type])");
  if (button) button.disabled = true;
  try {
    if (form.getAttribute("id") === "complete-move") {
      const m = move(form.dataset.id),
        v = { ...(m.draft || m) };
      for (const k of ["name", "part", "muscle", "originalName", "source"])
        v[k] = f.get(k);
      for (const k of ["aliases", "gear", "optionalGear", "secondaryMuscles"])
        v[k] = f
          .get(k)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      for (const k of ["steps", "tips"])
        v[k] = f
          .get(k)
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      v.warmup = f.get("warmup") === "热身";
      v.originalDescription ||= m.steps.join("\n");
      await call("move-draft", {
        id: m.id,
        base: m.version,
        value: v,
        reason: f.get("reason"),
      });
      await refresh();
      toast("草稿已保存，审核发布后生效");
    }
    if (form.getAttribute("id") === "complete-ai") {
      const value = structuredClone(currentConfig("ai"));
      for (const [k, v] of f) {
        if (k === "provider") continue;
        if (k === "enabled") value.enabled = v === "启用";
        else
          value[k] = ["model", "fallbackModel", "prompt"].includes(k)
            ? v
            : v === ""
              ? null
              : Number(v);
      }
      await api("admin/draft", {
        module: "ai",
        base: config.ai.version,
        value,
      });
      config.ai = null;
      await render();
      toast("配置草稿已保存");
    }
    if (form.getAttribute("id") === "complete-meal") {
      const m = meals().find((m) => m.id === form.dataset.id),
        items = m.rows.map((r, i) => ({
          id: String(f.get("food-" + i)).split(" · ")[0],
          locked:
            f.get("weight-" + i) === "" ? null : Number(f.get("weight-" + i)),
        }));
      mealPreview.set(
        m.id,
        await complete("meal-preview", { user: m.user, key: m.key, items }),
      );
      await render();
      toast("复算完成，未写回用户记录");
    }
  } catch (err) {
    toast(err.message);
  } finally {
    if (button) button.disabled = false;
  }
});
document.addEventListener(
  "load",
  (e) => {
    if (e.target.matches?.(".media-pair img")) {
      const images = $$(".media-pair img"),
        state = $(".media-status");
      if (state)
        state.textContent = images
          .map(
            (i) =>
              (i.alt || "素材") +
              "：" +
              (i.naturalWidth
                ? i.naturalWidth + " × " + i.naturalHeight + " px · 已加载"
                : "加载中"),
          )
          .join("；");
    }
  },
  true,
);
document.addEventListener(
  "error",
  (e) => {
    if (e.target.matches?.(".media-pair img")) {
      const state = $(".media-status");
      if (state)
        state.textContent = e.target.alt + "加载失败，请检查素材或网络";
    }
  },
  true,
);

// Additional filters are collapsed so the default toolbar keeps the design's density.
const baseFilters = filters,
  baseFiltered = filtered;
const extraFilters = {
  users: [
    ["activity", "业务使用", ["有收藏", "有计划", "有饮食", "调用过AI"]],
    ["dateField", "日期口径", ["注册时间", "最近活跃", "周期活跃"]],
  ],
  moves: [
    ["muscle", "目标肌群", () => [...new Set(D.moves.map((m) => m.muscle))]],
    ["level", "全部难度", () => [...new Set(D.moves.map((m) => m.level))]],
    [
      "pattern",
      "动作模式",
      () => [...new Set(D.moves.map((m) => m.pattern).filter(Boolean))],
    ],
    ["review", "审核状态", ["草稿", "待审核", "已发布", "已退回"]],
    ["missing", "完整性", ["说明缺失", "素材缺失"]],
  ],
  plans: [
    ["status", "计划状态", ["已保存", "已归档"]],
    ["source", "计划来源", ["规则生成", "用户自建"]],
    ["modified", "修改状态", ["已修改", "未修改"]],
  ],
  meals: [["meal", "全部餐次", ["早餐", "午餐", "晚餐", "加餐"]]],
  generations: [
    [
      "scene",
      "全部场景",
      () => [...new Set(A.generations.map((g) => g.scene))],
    ],
    ["model", "全部模型", () => [...new Set(A.calls.map((c) => c.model))]],
    ["retry", "重试情况", ["有重试", "无重试"]],
    [
      "version",
      "提示词版本",
      () => [...new Set(A.generations.map((g) => String(g.config.version)))],
    ],
  ],
  calls: [
    [
      "user",
      "用户 / 触发者",
      () => [...new Set(A.generations.map((g) => g.user))],
    ],
  ],
  costs: [
    [
      "user",
      "用户 / 触发者",
      () => [...new Set(A.generations.map((g) => g.user))],
    ],
  ],
  logs: [
    [
      "action",
      "全部操作",
      () => [...new Set((D.logs || []).map((l) => l.action))],
    ],
  ],
};
filters = function (fields = [], placeholder) {
  const extra = extraFilters[route().page]?.filter(
    ([k]) => !fields.some(([existing]) => existing === k),
  );
  let html = baseFilters(fields, placeholder);
  if (extra) {
    const f = filtersState[route().page] || {};
    html = html.replace(
      "</form>",
      `<details class="filter-more" ${extra.some(([k]) => f[k]) ? "open" : ""}><summary>更多筛选</summary><div class="form-grid top-space">${extra.map(([k, n, vs]) => select(n, k, ["", ...(typeof vs === "function" ? vs() : vs)], f[k] || "")).join("")}</div></details></form>`,
    );
  }
  return html;
};
filtered = function (rows, text, fields = {}) {
  const r = route(),
    f = filtersState[r.page] || {};
  const extra = {};
  for (const [k] of extraFilters[r.page] || []) {
    if (k === "dateField") continue;
    extra[k] = (x) => {
      if (k === "activity")
        return (f.activity === "有收藏" && x.prefs?.favorites.length) ||
          (f.activity === "有计划" && x.plans?.length) ||
          (f.activity === "有饮食" && Object.keys(x.meals || {}).length) ||
          (f.activity === "调用过AI" &&
            A.generations.some((g) => g.user === x.id))
          ? f.activity
          : "";
      if (k === "missing")
        return (f.missing === "说明缺失" && !x.steps?.length) ||
          (f.missing === "素材缺失" && x.id?.startsWith("N") && !x.media?.cover)
          ? f.missing
          : "";
      if (k === "meal") return ["早餐", "午餐", "晚餐", "加餐"][x.index];
      if (k === "retry") return callsOf(x.id).length > 1 ? "有重试" : "无重试";
      if (k === "model" && r.page === "generations")
        return callsOf(x.id).some((c) => c.model === f.model) ? f.model : "";
      if (k === "version") return String(x.config?.version);
      return x[k];
    };
  }
  const input =
    r.page === "users" && ["最近活跃", "周期活跃"].includes(f.dateField)
      ? rows.map((x) => ({
          ...x,
          at:
            f.dateField === "最近活跃"
              ? x.last
              : (D.activity || [])
                  .filter(
                    (a) =>
                      a.user === x.id &&
                      (!f.from || a.day >= f.from) &&
                      (!f.to || a.day <= f.to),
                  )
                  .at(-1)?.last || null,
          created: null,
        }))
      : rows;
  return baseFiltered(input, text, { ...fields, ...extra });
};
const baseMovesPage = movesPage;
views.moves = () => {
  let html = baseMovesPage();
  if (selected.size)
    html = html.replace(btn("批量下架", "bulk-off"), xbtn("批量维护", "batch"));
  return html;
};
const baseCostsPage = costsPage;
views.costs = () => {
  const html = baseCostsPage().replace(
    btn("登记周期账单", "period-bill"),
    xbtn("登记周期账单", "period-bill") + xbtn("登记资金资料", "funding"),
  );
  return (
    html +
    section("账单原币与换算", billsTable(A.bills.filter((b) => !b.call_id))) +
    section("退款与调整", adjustmentsTable(A.bills)) +
    section(
      "充值、额度与余额（不计入调用消耗）",
      table(
        ["类型", "原币", "人民币折算", "来源", "日期"],
        (A.funding || []).map((x) => [
          esc(x.kind),
          esc(x.original + " " + x.currency),
          money(x.amount),
          esc(x.source),
          time(x.at),
        ]),
      ),
    )
  );
};
Object.assign(moveFilter, {
  muscle: (m) => m.muscle,
  level: (m) => m.level,
  pattern: (m) => m.pattern,
});

const moduleReview = (module, c) =>
  section(
    "审核与版本",
    note("当前 v" + c.version + " · " + (c.draft?.status || "无草稿")) +
      `<div class="actions top-space">${c.draft ? btn("提交审核", "module-submit:" + module) : ""}${c.draft?.status === "待审核" ? btn("批准发布", "module-publish:" + module, "primary") + btn("退回修改", "module-reject:" + module) : ""}</div>` +
      table(
        ["版本", "操作"],
        (c.history || []).map((n) => [
          "v" + n,
          xbtn("查看版本", "version:" + module + ":" + n) +
            btn("回退", "module-rollback:" + module + ":" + n),
        ]),
      ),
  );
async function foodsPage() {
  if (!can("content.view")) return note("无食材配置权限");
  if (!config.foods)
    config.foods = await api("admin/inspect", { module: "foods" });
  const c = config.foods,
    v = currentConfig("foods");
  return (
    title(
      "食材资料",
      "每百克营养、生熟口径和过敏原核对分别维护。",
      can("content.edit") ? xbtn("新增食材", "food-edit:", "primary") : "",
    ) +
    `<section class="section">${filters([], "搜索食材名称或编号")}${page(
      filtered(v, (f) => f.id + f.name),
      [
        "食材",
        "生熟口径",
        "每100g：碳水 / 蛋白 / 脂肪",
        "过敏原核对",
        "状态",
        "操作",
      ],
      (f) => [
        esc(f.name) + '<span class="sub">' + esc(f.id) + "</span>",
        esc(f.state),
        [f.carb, f.protein, f.fat].join(" / ") + " g",
        esc((f.checked || []).join("、") || "未核对"),
        badge(f.enabled ? "启用" : "已停用"),
        can("content.edit") ? xbtn("编辑", "food-edit:" + f.id) : "—",
      ],
    )}</section>` +
    moduleReview("foods", c)
  );
}
const goalPolicyFields = [
  ['deficit','减脂缺口比例（0.15 即 15%）',0.15], ['surplus','增肌盈余比例（0.05 即 5%）',0.05],
  ['proteinPerKg','抗阻训练蛋白质 g/kg',1.6], ['fatPercent','抗阻训练脂肪供能 %',25],
  ['floorMale','男性自动目标下限 千卡',1500], ['floorFemale','女性自动目标下限 千卡',1200],
  ['adjustment','单次调整 千卡',100], ['observationDays','调整后观察天数',14], ['minSamples','每周最少体重记录天数',3]
];
function goalPolicyEditor(value) {
  const p = value || {};
  return '<h3 class="top-space">阶段目标与趋势调整</h3>' + note('减脂/维持/增肌共用阶段目标。通常训练已包含在活动系数中，不重复加回运动热量。通用自动分配限18至64岁、BMI 18.5至不足30的一般健康成人；低于下限时拦截，不机械抬高结果。') +
    select('启用已核对的目标策略','goal-approved',['停用','启用'],p.approved?'启用':'停用') +
    '<div class="form-grid three">' + goalPolicyFields.map(([key,label,fallback])=>field(label,'goal-'+key,p[key]??fallback,'number')).join('') + '</div>' +
    field('目标策略依据与适用范围','goal-source',p.source || 'Mifflin-St Jeor https://pubmed.ncbi.nlm.nih.gov/2305711/；运动蛋白质 https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/；15%缺口、5%盈余为产品起点，结合实际趋势复核。','textarea');
}
let energyTrial = null, energyTrialInput = {goal:"减脂",sex:"男",age:30,height:175,weight:70,activity:"中等活动",resistance:"是"};
async function nutritionPage() {
  if (!can("content.view")) return note("无营养规则权限");
  if (!config.nutrition)
    config.nutrition = await api("admin/inspect", { module: "nutrition" });
  const c = config.nutrition,
    v = currentConfig("nutrition"),
    e = v.estimation;
  return (
    title("营养计算规则", "专业目标、分餐和估算参数按发布版本生效。") +
    section(
      "供能与估算",
      `<form id="complete-nutrition"><div class="form-grid three">${["碳水", "蛋白质", "脂肪"].map((k, i) => field(k + "供能占比（%）", "ratio" + i, v.macroRatio[i], "number")).join("")}</div><h3 class="top-space">能量估算</h3>${select("启用已核对的估算规则", "approved", ["停用", "启用"], e.approved ? "启用" : "停用")}<div class="form-grid">${["weight", "height", "age"].map((k, i) => field(["体重系数", "身高系数", "年龄系数"][i], k, e[k], "number")).join("")}${Object.entries(
        e.offset,
      )
        .map(([k, v]) => field(k + "偏移量", "offset-" + k, v, "number"))
        .join("")}${Object.entries(e.activity)
        .map(([k, v]) => field(k + "活动系数", "activity-" + k, v, "number"))
        .join(
          "",
        )}</div>${field("依据与适用范围", "source", e.source, "textarea")}${goalPolicyEditor(v.goalPolicy)}<button class="btn primary top-space">保存草稿</button></form>`,
    ) +
    section('目标饮食试算', `<form id="complete-energy-trial"><div class="form-grid three">${select('目标','goal',['减脂','维持','增肌'],energyTrialInput.goal)}${select('性别','sex',['男','女'],energyTrialInput.sex)}${field('年龄','age',energyTrialInput.age,'number')}${field('身高 cm','height',energyTrialInput.height,'number')}${field('体重 kg','weight',energyTrialInput.weight,'number')}${select('通常整周活动','activity',Object.keys(e.activity || {}),energyTrialInput.activity)}${select('通常抗阻训练','resistance',['是','否'],energyTrialInput.resistance)}</div><button class="btn primary">按已保存规则试算</button></form>` + (energyTrial ? kv([['维持消耗估算',energyTrial.energy.maintenance+' 千卡'],['每日'+energyTrial.goal+'饮食目标',energyTrial.targets.kcal+' 千卡'],['蛋白质 / 脂肪 / 碳水',[energyTrial.targets.protein,energyTrial.targets.fat,energyTrial.targets.carb].join(' / ')+' g']]) + note('通常训练已包括在活动系数中。本试算不写入用户账号。') : '')) +
    moduleReview("nutrition", c)
  );
}
let templateTrial = null,
  templateSample = { goal: "增肌", days: 3, minutes: 30, gear: ["哑铃"] };
async function completeTemplatesPage() {
  if (!config.templates)
    config.templates = await api("admin/inspect", { module: "templates" });
  const c = config.templates,
    ss = Object.values(templateTrial?.sessions || {}),
    day = route().params.get("day") || ss[0]?.date,
    chosen = ss.find((s) => s.date === day);
  return (
    title(
      "训练模板与规则",
      "系统模板用于新生成计划；用户计划保留自己的副本。",
      can("content.edit") ? xbtn("维护模板草稿", "template-edit") : "",
    ) +
    `<div class="columns trial-layout">${section("模拟用户条件", `<form id="complete-trial">${select("目标", "goal", ["增肌", "减脂", "日常健身"], templateSample.goal)}<div class="form-grid">${field("每周天数", "days", templateSample.days, "number")}${field("每次分钟", "minutes", templateSample.minutes, "number")}</div>${field("开始周一", "start", templateTrial?.start || mondayLocal(), "date")}${field("经验", "experience", templateSample.experience || "基础")}${field("可用器械（逗号分隔）", "gear", templateSample.gear.join(","))}<button class="btn primary top-space">生成试排结果</button></form><div class="top-space">${note("试排不写入用户个人计划，也不调用 AI。")}</div>`)}${section(
      "一周试排预览",
      templateTrial
        ? note(
            templateTrial.days +
              " 次训练 / 每次 " +
              templateTrial.minutes +
              " 分钟",
          ) +
            `<div class="week">${ss.map((s) => {
              const date = s.date, i = (new Date(date + "T12:00:00").getDay() + 6) % 7;
              return `<a href="#/templates?day=${date}" class="week-day trained ${day === date ? "on" : ""}"><span>周${"一二三四五六日"[i]}</span><b>${esc(s.type)}</b>${s.budget} 分钟</a>`;
            }).join("")}</div>` +
            (chosen
              ? table(
                  ["动作", "组次", "预计用时", "入选模式"],
                  chosen.items.map((i) => [
                    moveLink(i.id),
                    i.sets + " × " + i.target + " " + i.unit,
                    Math.round(
                      (i.sets *
                        i.target *
                        (i.unit === "秒" ? 1 : i.seconds || 3) +
                        Math.max(0, i.sets - 1) * i.rest) /
                        60,
                    ) + " 分钟",
                    esc(i.pattern),
                  ]),
                ) +
                kv([
                  ["总用时", Math.ceil(chosen.timing.total / 60) + " 分钟"],
                  [
                    "热身",
                    chosen.timing.warm == null
                      ? "含热身动作"
                      : chosen.timing.warm + " 秒",
                  ],
                  [
                    "转换",
                    chosen.timing.transition == null
                      ? "已计入总用时"
                      : chosen.timing.transition + " 秒",
                  ],
                ])
              : "") +
            section(
              "候选排除原因",
              table(
                ["动作", "原因"],
                [
                  ...new Map(
                    (templateTrial.rejected || []).map((x) => [
                      x.id + "-" + x.reason,
                      x,
                    ]),
                  ).values(),
                ].map((x) => [moveLink(x.id), esc(x.reason)]),
              ),
            )
        : note("填写左侧条件后生成试排结果。"),
    )}</div>` +
    moduleReview("templates", c)
  );
}
function mondayLocal() {
  const d = new Date(),
    offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-complete]");
  if (!el) return;
  const [a, ...rest] = el.dataset.complete.split(":"),
    id = rest.join(":");
  try {
    if (a === "food-edit") {
      const all = currentConfig("foods"),
        food = all.find((f) => f.id === id) || {
          id: "",
          name: "",
          state: "",
          primary: "protein",
          enabled: true,
          oil: false,
          contains: [],
          checked: [],
          tags: [],
        };
      modal(
        id ? "编辑食材" : "新增食材",
        `<div class="form-grid">${[
          ["食材编号", "id"],
          ["名称", "name"],
          ["生熟与称重口径", "state"],
          ["来源链接", "source"],
          ["来源版本", "sourceVersion"],
        ]
          .map(([n, k]) => field(n, k, food[k] || ""))
          .join(
            "",
          )}${select("主要营养类别", "primary", ["carb", "protein", "fat"], food.primary)}${Object.entries(
          metricNames,
        )
          .map(([k, n]) => field("每100g" + n, k, food[k] ?? 0, "number"))
          .join(
            "",
          )}${select("状态", "enabled", ["启用", "停用"], food.enabled ? "启用" : "停用")}${select("油脂按1g取整", "oil", ["否", "是"], food.oil ? "是" : "否")}</div>${field("含有的过敏原（逗号分隔）", "contains", food.contains.join(","))}${field("已核对的过敏原（逗号分隔）", "checked", food.checked.join(","))}${field("食材标签", "tags", food.tags.join(","))}${field("描述", "description", food.description || "", "textarea")}`,
        async (f) => {
          const value = { ...food, ...Object.fromEntries(f) };
          for (const k of Object.keys(metricNames)) value[k] = Number(f.get(k));
          for (const k of ["contains", "checked", "tags"])
            value[k] = f
              .get(k)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
          value.enabled = f.get("enabled") === "启用";
          value.oil = f.get("oil") === "是";
          if (id) value.id = id;
          const next = all.filter((x) => x.id !== id);
          next.push(value);
          await api("admin/draft", {
            module: "foods",
            base: config.foods.version,
            value: next,
          });
          config.foods = null;
          await render();
        },
      );
      return;
    }
    if (a === "template-edit") {
      const v = currentConfig("templates");
      modal("维护系统模板", templateFields(v), async (f) => {
        const value = structuredClone(v);
        value.enabled = f.has("enabled");
        value.dates = value.dates.map((_, i) =>
          f
            .get("dates" + i)
            .split(",")
            .map((x) => Number(x.trim()) - 1),
        );
        for (const k of Object.keys(value.patterns))
          value.patterns[k] = f
            .get("pattern-" + k)
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
        for (const k of Object.keys(value.sets))
          value.sets[k] = Number(f.get("sets-" + k));
        await api("admin/draft", {
          module: "templates",
          base: config.templates.version,
          value,
        });
        config.templates = null;
        await render();
      });
      return;
    }
  } catch (err) {
    toast(err.message);
  }
});
document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (
    !["complete-nutrition", "complete-trial", "complete-energy-trial"].includes(form.getAttribute("id"))
  )
    return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const f = new FormData(form);
  try {
    if (form.getAttribute('id') === 'complete-energy-trial') {
      energyTrialInput = Object.fromEntries(f.entries());
      const result = await api('preview/draft', {module:'nutrition', value:currentConfig('nutrition'), sample:{profile:{energyModel:'goal-v1',estimate:true,generalAdult:true,resistance:f.get('resistance')==='是',goal:f.get('goal'),sex:f.get('sex'),age:Number(f.get('age')),height:Number(f.get('height')),weight:Number(f.get('weight')),activity:f.get('activity'),ratios:[30,40,30]},index:1,items:[]}});
      energyTrial = result.profile; await render();
    } else if (form.getAttribute("id") === "complete-nutrition") {
      const value = structuredClone(currentConfig("nutrition"));
      value.macroRatio = [0, 1, 2].map((i) => Number(f.get("ratio" + i)));
      for (const k of ["weight", "height", "age"])
        value.estimation[k] = Number(f.get(k));
      for (const k of Object.keys(value.estimation.offset))
        value.estimation.offset[k] = Number(f.get("offset-" + k));
      for (const k of Object.keys(value.estimation.activity))
        value.estimation.activity[k] = Number(f.get("activity-" + k));
      value.estimation.approved = f.get("approved") === "启用";
      value.estimation.source = f.get("source");
      value.goalPolicy = { approved: f.get('goal-approved') === '启用', source: f.get('goal-source') };
      for (const [key] of goalPolicyFields) value.goalPolicy[key] = Number(f.get('goal-'+key));
      await api("admin/draft", {
        module: "nutrition",
        base: config.nutrition.version,
        value,
      });
      config.nutrition = null;
      energyTrial = null;
      await render();
      toast("规则草稿已保存");
    } else {
      templateSample = {
        goal: f.get("goal"),
        days: Number(f.get("days")),
        minutes: Number(f.get("minutes")),
        start: f.get("start"),
        experience: f.get("experience"),
        gear: f
          .get("gear")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      templateTrial = await api("preview/draft", {
        module: "templates",
        value: currentConfig("templates"),
        sample: templateSample,
      });
      await render();
      toast("试排完成，未写入用户计划");
    }
  } catch (err) {
    toast(err.message);
  }
});
views.foods = foodsPage;
views.nutrition = nutritionPage;
views.templates = completeTemplatesPage;
const baseMealsPage = mealsPage;
views.meals = () =>
  baseMealsPage().replace(
    btn("食材与规则", "food-config"),
    link("食材资料", "foods") + "　" + link("营养规则", "nutrition"),
  );
const costPath = (extra = {}) =>
  "calls?" +
  new URLSearchParams({ ...filtersState.costs, ...extra, page: 1 }).toString();
function groupedCosts(rows, label, key, param) {
  const keys = [...new Set(rows.map(key))].sort();
  return section(
    label,
    table(
      [
        "分组",
        "调用数",
        "成功率",
        "确认费用",
        "待确认估算",
        "未知",
        "重试费用",
      ],
      keys.map((k) => {
        const cs = rows.filter((c) => key(c) === k),
          p = prices(cs);
        return [
          link(k, costPath(param(k))),
          cs.length,
          (
            (100 * cs.filter((c) => c.result === "成功").length) /
            cs.length
          ).toFixed(1) + "%",
          money(p.confirmed),
          money(p.pending),
          p.unknown,
          costCell(cs.filter((c) => c.seq > 1)),
        ];
      }),
    ),
  );
}
const completeCostsBase = views.costs;
views.costs = async () => {
  if (!can("ai.cost")) return note("无费用查看权限");
  const rows = filtered(callRows(), (c) => c.model + c.user, {
      environment: (c) => c.environment,
      scene: (c) => c.scene,
    }),
    f = filtersState.costs || {},
    today = localDay(new Date()),
    daily = prices(A.calls.filter((c) => localDay(c.at) === today)),
    month = prices(
      A.calls.filter((c) => localDay(c.at).slice(0, 7) === today.slice(0, 7)),
    );
  let budget = "";
  if (can("ai.view")) {
    if (!config.ai) config.ai = await api("admin/inspect", { module: "ai" });
    const v =
        typeof config.ai.active === "string"
          ? JSON.parse(config.ai.active)
          : config.ai.active,
      reserve = sumMoney(
        A.calls
          .filter(
            (c) =>
              localDay(c.at) === today &&
              c.confirmed == null &&
              c.estimate == null,
          )
          .map((c) => c.reserve),
      );
    budget = section(
      "今日 / 本月与预算",
      kv([
        ["今日确认", money(daily.confirmed)],
        ["今日待确认", money(daily.pending)],
        ["本月确认", money(month.confirmed)],
        ["本月待确认", money(month.pending)],
        ["每日预算", v.dailyBudget == null ? "未设置" : money(v.dailyBudget)],
        [
          "保守预算余量",
          v.dailyBudget == null
            ? "未设置"
            : money(
                Math.max(
                  0,
                  v.dailyBudget - daily.confirmed - daily.pending - reserve,
                ),
              ),
        ],
      ]) +
        note(
          "此处为当前授权范围的北京时间自然日 / 自然月，不随下方日期筛选变化；余量扣除未知调用的预留，仅为参考。",
        ),
    );
  }
  return (
    completeCostsBase() +
    budget +
    groupedCosts(
      rows,
      "按月统计",
      (c) => localDay(c.at).slice(0, 7),
      (m) => ({
        from: m + "-01",
        to: new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0))
          .toISOString()
          .slice(0, 10),
      }),
    ) +
    groupedCosts(
      rows,
      "按业务场景",
      (c) => c.scene,
      (k) => ({ scene: k }),
    ) +
    groupedCosts(
      rows,
      "按生成结果",
      (c) =>
        A.generations.find((g) => g.id === c.generation)?.status || "未记录",
      (k) => ({ generationStatus: k }),
    ) +
    section(
      "高费用用户排行",
      table(
        ["用户 / 触发者", "生成次数", "调用次数", "总成本含估算", "日均成本"],
        [...new Set(rows.map((c) => c.user))]
          .map((u) => {
            const cs = rows.filter((c) => c.user === u),
              p = prices(cs),
              days = new Set(cs.map((c) => localDay(c.at))).size;
            return { u, cs, p, days, total: p.confirmed + p.pending };
          })
          .sort((a, b) => b.total - a.total)
          .map((x) => [
            userLink(x.u),
            new Set(x.cs.map((c) => c.generation)).size,
            link(x.cs.length, costPath({ user: x.u })),
            money(x.total),
            money(x.total / x.days) + " / 有调用日",
          ]),
      ),
    )
  );
};
extraFilters.calls.push([
  "generationStatus",
  "生成结果",
  ["成功交付", "规则回退", "处理中", "待核对"],
]);
const detailFiltered = filtered;
filtered = function (rows, text, fields = {}) {
  return detailFiltered(rows, text, {
    ...fields,
    generationStatus: (c) =>
      A.generations.find((g) => g.id === c.generation)?.status,
  });
};
views.overview = () => {
  const f = filtersState.overview || {},
    range = (x) =>
      (!f.from || localDay(x) >= f.from) && (!f.to || localDay(x) <= f.to),
    us = D.users || [],
    gs = A.generations.filter((g) => range(g.at)),
    cs = A.calls.filter((c) => range(c.at)),
    p = prices(cs),
    fe = (D.favoriteEvents || []).filter((e) => range(e.at)),
    act = (D.activity || []).filter((e) => range(e.last)),
    path = (p, extra = {}) =>
      p +
      "?" +
      new URLSearchParams({ from: f.from || "", to: f.to || "", ...extra });
  return (
    title("运营概览", "北京时间 UTC+8 · 所有指标均可追溯至业务记录。") +
    filters([], "用户与业务数据概览") +
    summary([
      [
        "新增账号",
        us.filter((u) => u.created && range(u.created)).length,
        "旧账号未采集注册时间",
        path("users"),
      ],
      [
        "活跃账号",
        new Set(act.map((x) => x.user)).size,
        "按日去重，开始记录后统计",
        path("users", { dateField: "周期活跃" }),
      ],
      ["当前收藏", favorites().length, "不受日期筛选影响", "favorites"],
      [
        "新增 / 取消收藏",
        fe.filter((e) => e.kind !== "取消").length +
          " / " +
          fe.filter((e) => e.kind === "取消").length,
        "所选周期事件",
        path("favorites", { tab: "events" }),
      ],
    ]) +
    summary([
      [
        "已保存计划",
        plans().filter((p) => (p.created ? range(p.created) : !f.from && !f.to))
          .length,
        "按计划 ID 去重",
        path("plans"),
      ],
      [
        "完成训练",
        us.reduce(
          (n, u) =>
            n + u.history.filter((h) => range(h.endedAt || h.date)).length,
          0,
        ),
        "实际完成课程",
        path("plans"),
      ],
      ["AI 生成", gs.length, "业务生成数", path("generations")],
      ["实际调用", cs.length, "含失败、重试、备用模型", path("calls")],
    ]) +
    summary([
      [
        "已确认费用",
        can("ai.cost") ? money(p.confirmed) : "无权限",
        "扣除关联退款和调整",
        path("calls"),
      ],
      [
        "待确认估算",
        can("ai.cost") ? money(p.pending) : "无权限",
        "按历史价格版本",
        path("calls", { billing: "仅估算" }),
      ],
      [
        "未知费用",
        can("ai.cost") ? p.unknown + " 笔" : "无权限",
        "待核对用量 / 账单",
        path("calls", { billing: "未获得用量" }),
      ],
      [
        "未成功生成",
        gs.filter((g) => g.status !== "成功交付").length,
        "保留失败 / 回退及费用",
        path("generations"),
      ],
    ]) +
    section(
      "待处理事项",
      table(
        ["事项", "数量", "入口"],
        [
          [
            "待审核动作",
            (D.moves || []).filter((m) => m.status === "待审核").length,
            link("查看动作", "moves?review=待审核"),
          ],
          [
            "规则回退",
            gs.filter((g) => g.status === "规则回退").length,
            link("查看生成", path("generations", { status: "规则回退" })),
          ],
        ],
      ),
    )
  );
};

const editableForms = {
  "complete-move": "content.edit",
  "media-form": "content.edit",
  "schedule-form": "content.edit",
  "complete-nutrition": "content.edit", "complete-energy-trial": "content.view",
  "complete-ai": "ai.edit",
};
const permissionActions = {
  "submit-move": "content.edit",
  "submit-ai": "ai.edit",
  alternatives: "content.edit",
  "module-submit": "content.edit",
  "module-publish": "content.publish",
  "module-reject": "content.publish",
  "module-rollback": "content.publish",
};
const detailRender = render;
render = async function () {
  await detailRender();
  for (const [id, permission] of Object.entries(editableForms)) {
    const form = document.getElementById(id);
    if (form && !can(permission)) {
      form
        .querySelectorAll("input,select,textarea,button")
        .forEach((x) => (x.disabled = true));
    }
  }
  document.querySelectorAll("[data-action],[data-complete]").forEach((el) => {
    const raw = el.dataset.action || el.dataset.complete,
      [action, module] = raw.split(":");
    let permission = permissionActions[action];
    if (action.startsWith("module-") && module === "ai")
      permission = permission?.replace("content.", "ai.");
    if (permission && !can(permission)) el.hidden = true;
  });
};
