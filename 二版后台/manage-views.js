"use strict";
function usersPage() {
  const us = D.users || [],
    rows = filtered(us, (u) => u.id + u.name, { status: (u) => u.status });
  return (
    title(
      "用户管理",
      "从一个账号，查看完整的训练、收藏与饮食数据。",
      can("users.export") ? btn("导出当前结果", "export:users") : "",
    ) +
    summary([
      ["账号总数", us.length, "已登录并同步的账号"],
      [
        "正常账号",
        us.filter((u) => u.status === "正常").length,
        "可正常访问业务",
      ],
      ["已保存计划", plans().length, "按计划 ID 去重"],
      ["当前收藏", favorites().length, "有效用户—动作关系"],
    ]) +
    `<section class="section">${filters([["status", "全部账号状态", ["正常", "已限制"]]], "搜索用户 ID 或昵称")}${page(rows, ["用户", "账号状态", "注册 / 最近活跃", "当前收藏", "周计划", "完成训练", "AI 生成 / 调用", "AI 费用", "操作"], (u) => [`<div class="identity"><span class="avatar">未</span><div>${userLink(u.id)}<span class="sub mono" title="${u.id}">${esc(u.id)}</span></div></div>`, badge(u.status), `${time(u.created)}<span class="sub">${time(u.last)}</span>`, link(u.prefs.favorites.length, "favorites?user=" + u.id), link(u.plans.length, "plans?user=" + u.id), u.history.length + " 次", A.generations.filter((g) => g.user === u.id).length + " / " + userCalls(u.id).length, costCell(userCalls(u.id)), link("查看详情", "user/" + u.id)])}</section>`
  );
}
async function userPage() {
  const u = user(route().id);
  if (!u) return note("记录不存在、已清理或不在当前授权范围");
  if (!detail[u.id]) detail[u.id] = await call("user", { id: u.id });
  const tab = route().params.get("tab") || "profile",
    d = detail[u.id];
  let body = "";
  if (tab === "profile")
    body = section(
      "基础资料",
      d.profile !== undefined
        ? kv(
            Object.entries(d.profile || {}).map(([k, v]) => [
              k,
              esc(typeof v === "object" ? JSON.stringify(v) : v),
            ]),
          ) +
            section(
              "资料历史",
              table(
                ["时间", "变更"],
                d.events
                  .filter((e) => e.action === "profile")
                  .map((e) => [
                    time(e.at),
                    pre({ before: e.before.profile, after: e.after.profile }),
                  ]),
              ),
            )
        : note(
            u.profileProvided
              ? "身体资料已填写，查看详情需要单独授权并填写访问原因。"
              : "用户尚未填写身体资料。",
          ) +
            (can("users.sensitive")
              ? btn("授权查看", "reveal-user:" + u.id)
              : ""),
    );
  if (tab === "gear")
    body =
      section(
        "已拥有器械",
        `<div class="chips">${u.prefs.owned.map((g) => `<span class="chip">${esc(g)}</span>`).join("") || "尚未同步器械"}</div>`,
      ) +
      section(
        "器械与偏好变更",
        table(
          ["时间", "变更前", "变更后"],
          d.events
            .filter((e) => e.action === "sync")
            .map((e) => [
              time(e.at),
              esc(e.before.prefs.owned.join("、")),
              esc(e.after.prefs.owned.join("、")),
            ]),
        ),
      );
  if (tab === "favorites")
    body = section(
      "当前收藏",
      table(
        ["动作", "所属部位", "状态"],
        u.prefs.favorites.map((id) => [
          moveLink(id),
          esc(move(id)?.part),
          badge(move(id)?.visible === false ? "已下架" : "已上架"),
        ]),
      ),
      link("查看全局收藏与事件", "favorites?user=" + u.id),
    );
  if (tab === "plans")
    body = section(
      "训练计划",
      table(
        ["计划", "目标", "日期", "课程"],
        u.plans.map((p) => [
          link(p.id, "plan/" + p.id),
          esc(p.goal),
          p.start,
          Object.values(u.sessions).filter(
            (s) => s.date >= p.start && s.date <= shift(p.start, 6),
          ).length,
        ]),
      ),
      link("查看全部计划", "plans?user=" + u.id),
    );
  if (tab === "meals")
    body = section(
      "饮食记录",
      table(
        ["日期", "餐次", "详情"],
        meals()
          .filter((m) => m.user === u.id)
          .map((m) => [
            m.date,
            ["早餐", "午餐", "晚餐"][m.index] || m.key,
            link("查看搭配", "meal/" + m.id),
          ]),
      ),
      link("全局饮食记录", "meals?user=" + u.id),
    );
  if (tab === "ai")
    body = section(
      "AI 使用",
      table(
        ["生成记录", "场景", "结果", "费用"],
        A.generations
          .filter((g) => g.user === u.id)
          .map((g) => [
            link(g.id, "generation/" + g.id),
            esc(g.scene),
            badge(g.status),
            costCell(callsOf(g.id)),
          ]),
      ),
      link("所有关联生成", "generations?user=" + u.id),
    );
  if (tab === "account")
    body =
      section(
        "账号与处理记录",
        kv([
          ["状态", badge(u.status)],
          ["最近访问", time(u.last)],
          ["内部备注", esc(u.note || "暂无")],
        ]) +
          `<div class="actions top-space">${btn("添加内部备注", "note:" + u.id)}${can("users.manage") ? btn(u.status === "正常" ? "限制账号" : "恢复账号", "user-status:" + u.id) : ""}</div>`,
      ) +
      section(
        "反馈与注销申请",
        table(
          ["编号", "类型", "状态", "内容"],
          d.tickets.map((t) => [
            t.id,
            esc(t.kind),
            badge(t.status),
            esc(t.detail),
          ]),
        ),
      );
  return (
    title(
      "用户详情",
      "所有关联入口使用同一份用户数据。",
      link("返回用户列表", "users"),
    ) +
    `<div class="user-banner"><div class="identity"><span class="avatar large">未</span><div><h1>${esc(u.name)}</h1><p class="mono">${esc(u.id)}</p><div class="meta">${badge(u.status)}<span>注册 ${time(u.created)}</span><span>最近活跃 ${time(u.last)}</span></div></div></div><div class="mini-stats"><div><b>${u.prefs.favorites.length}</b><span>收藏</span></div><div><b>${u.plans.length}</b><span>周计划</span></div><div><b>${u.history.length}</b><span>完成训练</span></div></div></div>` +
    tabs(
      [
        ["profile", "基础资料"],
        ["gear", "器械与偏好"],
        ["favorites", "收藏"],
        ["plans", "训练计划"],
        ["meals", "饮食"],
        ["ai", "AI 使用"],
        ["account", "账号与处理记录"],
      ],
      "profile",
    ) +
    body
  );
}
function favoritesPage() {
  const events = route().params.get("tab") === "events",
    rows = filtered(
      events
        ? (D.favoriteEvents || []).map((e) => ({ ...e, user: e.uid }))
        : favorites(),
      (x) => x.user + x.move + (move(x.move)?.name || ""),
      { part: (x) => move(x.move)?.part, kind: (x) => x.kind },
    );
  return (
    title(
      "收藏记录",
      "当前收藏与历史增减分开查看；旧记录的首次收藏时间不补造。",
    ) +
    `<div class="tabs plain">${link("当前收藏", "favorites" + (route().params.get("user") ? "?user=" + route().params.get("user") : ""))}${link("收藏事件", "favorites?tab=events" + (route().params.get("user") ? "&user=" + route().params.get("user") : ""))}</div><section class="section">${filters(
      [
        ["part", "全部部位", [...new Set((D.moves || []).map((m) => m.part))]],
        ["kind", "全部事件", ["添加", "取消", "游客合并"]],
      ],
    )}${page(
      rows,
      events
        ? ["事件", "用户", "动作", "当时部位", "事件类型", "时间 / 批次"]
        : ["收藏关系", "用户", "动作", "当前部位", "状态", "首次 / 最近收藏"],
      (x) =>
        events
          ? [
              esc(x.id),
              userLink(x.user),
              moveLink(x.move),
              esc(x.part),
              badge(x.kind),
              time(x.at) + `<span class="sub">${esc(x.request)}</span>`,
            ]
          : [
              esc(x.id),
              userLink(x.user),
              moveLink(x.move),
              esc(move(x.move)?.part),
              badge(move(x.move)?.visible === false ? "已下架" : "已收藏"),
              (() => {
                const es = (D.favoriteEvents || []).filter(
                  (e) =>
                    e.uid === x.user && e.move === x.move && e.kind !== "取消",
                );
                return (
                  time(es.at(-1)?.at) +
                  '<span class="sub">' +
                  time(es[0]?.at) +
                  "</span>"
                );
              })(),
            ],
    )}</section>`
  );
}
function plansPage() {
  const rows = filtered(plans(), (p) => p.id + p.user + p.goal, {
    goal: (p) => p.goal,
  });
  return (
    title(
      "训练计划",
      "查询已保存周计划、课程调整与实际训练；规则排课不产生 AI 消费。",
    ) +
    `<section class="section">${filters([["goal", "全部目标", ["增肌", "减脂", "日常健身"]]])}${page(
      rows,
      [
        "计划 ID",
        "用户",
        "周起止日期",
        "训练目标",
        "天数 / 时长",
        "状态",
        "版本",
        "完成 / 安排",
      ],
      (p) => {
        const ss = Object.values(user(p.user).sessions).filter(
          (s) => s.date >= p.start && s.date <= shift(p.start, 6),
        );
        return [
          link(p.id, "plan/" + p.id),
          userLink(p.user),
          p.start + " ~ " + shift(p.start, 6),
          esc(p.goal),
          p.days + " 天 / " + p.minutes + " 分钟",
          badge("已保存"),
          esc(JSON.stringify(p.version)),
          ss.filter((s) => s.status === "已完成").length + " / " + ss.length,
        ];
      },
    )}</section>`
  );
}
async function planPage() {
  const p = plans().find((p) => p.id === route().id);
  if (!p) return note("计划不存在或无权查看");
  const u = user(p.user);
  if (!detail[u.id]) detail[u.id] = await call("user", { id: u.id });
  const tab = route().params.get("tab") || "schedule",
    ss = Object.values(u.sessions).filter(
      (s) => s.date >= p.start && s.date <= shift(p.start, 6),
    );
  let body = "";
  if (tab === "schedule")
    body =
      ss
        .map((s) =>
          section(
            s.date + " · " + s.type,
            table(
              ["动作", "组数", "计划值", "休息", "状态"],
              s.items.map((i) => [
                moveLink(i.id),
                i.sets,
                i.target + " " + i.unit,
                i.rest + " 秒",
                badge(s.status),
              ]),
            ) +
              `<p class="muted top-space">课程 ID ${esc(s.key)}${s.carried ? " · 跨周调入" : ""}</p>`,
          ),
        )
        .join("") || note("此周尚未安排课程");
  if (tab === "input")
    body = section(
      "保存时的排课条件",
      kv([
        ["训练目标", esc(p.goal)],
        ["天数", p.days],
        ["每次时长", p.minutes + " 分钟"],
        ["器械", esc(p.gear.join("、"))],
        ["规则版本", esc(JSON.stringify(p.version))],
        ["来源", "规则生成 / 用户自行编排"],
      ]) + note("历史系统未采集的经验、首次生成输入以未记录处理。"),
    );
  if (tab === "changes")
    body = section(
      "修改前后版本",
      table(
        ["时间", "操作", "前后差异"],
        detail[u.id].events
          .filter(
            (e) =>
              JSON.stringify(e.before.sessions) !==
                JSON.stringify(e.after.sessions) &&
              Object.values({ ...e.before.sessions, ...e.after.sessions }).some(
                (s) => s.date >= p.start && s.date <= shift(p.start, 6),
              ),
          )
          .map((e) => [
            time(e.at),
            esc(e.action),
            `<details><summary>展开课程快照</summary><div class="diff">${pre(e.before.sessions)}${pre(e.after.sessions)}</div></details>`,
          ]),
      ),
    );
  if (tab === "actual")
    body = ss
      .map((s) =>
        section(
          s.date + " · " + s.status,
          kv([
            ["开始", time(s.startedAt)],
            ["结束", time(s.endedAt)],
            ["课程 ID", esc(s.key)],
          ]) +
            table(
              ["动作", "计划", "实际组记录"],
              s.items.map((i) => [
                esc(i.name),
                i.sets + " × " + i.target + " " + i.unit,
                esc(
                  (s.actual?.[i.key] || [])
                    .map(
                      (v) =>
                        v.value +
                        " " +
                        v.unit +
                        (v.weight != null ? " / " + v.weight + " kg" : ""),
                    )
                    .join("；") || "尚未记录",
                ),
              ]),
            ),
        ),
      )
      .join("");
  return (
    title(
      "训练计划详情",
      p.start + " ~ " + shift(p.start, 6),
      userLink(p.user),
    ) +
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
function mealsPage() {
  const rows = filtered(meals(), (m) => m.id + m.user + m.date, {
    meal: (m) => ["早餐", "午餐", "晚餐"][m.index],
  });
  return (
    title(
      "饮食记录",
      "用户最终保存的搭配；与 AI 推荐结果分别追溯。",
      can("content.view") ? btn("食材与规则", "food-config") : "",
    ) +
    `<section class="section">${filters([["meal", "全部餐次", ["早餐", "午餐", "晚餐"]]])}${page(rows, ["记录", "用户", "日期 / 餐次", "营养汇总", "食材 / 规则版本", "AI 关联"], (m) => [link(m.id, "meal/" + m.id), userLink(m.user), m.date + " / " + (["早餐", "午餐", "晚餐"][m.index] || m.key), esc(JSON.stringify(m.actual || m.total || m.totals || {})), "v" + m.foodsVersion + " / v" + m.nutritionVersion, m.generationId ? link("查看生成", "generation/" + m.generationId) : "手动搭配或旧记录未关联"])}</section>`
  );
}
function mealPage() {
  const m = meals().find((m) => m.id === route().id);
  if (!m) return note("饮食记录不存在或无权查看");
  return (
    title("饮食详情", m.date + " · " + m.key, userLink(m.user)) +
    section(
      "已保存的搭配",
      kv([
        ["食材版本", "v" + m.foodsVersion],
        ["营养规则", "v" + m.nutritionVersion],
        ["保存时间", time(m.savedAt)],
      ]) +
        table(
          ["食材", "重量", "生熟口径", "锁定", "营养"],
          (m.rows || m.items || []).map((i) => [
            esc(i.name || i.id),
            (i.grams ?? i.weight ?? "未记录") + " g",
            esc(i.state || "见食材快照"),
            i.locked != null ? "已锁定" : "未锁定",
            esc(JSON.stringify(i.actual || i.nutrition || {})),
          ]),
        ),
    ) +
    section(
      "目标、汇总与差额",
      pre({
        target: m.target,
        total: m.total,
        actual: m.actual,
        delta: m.delta,
        rows: m.rows,
        items: m.items,
      }),
    ) +
    section(
      "不写回用户的复算",
      note("使用当前已发布食材与规则；试算不会修改用户已保存的记录。") +
        btn("打开复算", "meal-recalc:" + m.id),
    )
  );
}
const moveFilter = {
  part: (m) => m.part,
  gear: (m) =>
    filtersState.moves?.gear && m.gear.includes(filtersState.moves.gear)
      ? filtersState.moves.gear
      : "",
  status: (m) => (m.visible ? "已上架" : "已下架"),
  auto: (m) => (m.enabled ? "可排课" : "未纳入"),
  type: (m) => (m.warmup ? "热身" : "正式动作"),
  review: (m) => m.status,
};
function movesPage() {
  const rows = filtered(
    D.moves || [],
    (m) => m.id + m.name + (m.originalName || "") + (m.aliases || []).join(""),
    moveFilter,
  );
  return (
    title(
      "全部动作",
      "查询全库资料、素材和发布状态；浏览与自动排课独立管理。",
      (can("content.edit")
        ? btn("新增动作", "move-new", "primary") +
          btn("导入动作草稿", "move-import")
        : "") +
        (can("content.export") ? btn("导出当前结果", "export:moves") : ""),
    ) +
    summary([
      ["目录动作", (D.moves || []).length, "全部状态"],
      [
        "已上架",
        (D.moves || []).filter((m) => m.visible).length,
        "新浏览列表可见",
      ],
      [
        "可自动排课",
        (D.moves || []).filter((m) => m.enabled && m.visible).length,
        "审核和排课属性完整",
      ],
      [
        "待审核",
        (D.moves || []).filter((m) => m.status === "待审核").length,
        "需要审核人员处理",
      ],
    ]) +
    `<section class="section">${filters(
      [
        ["part", "全部部位", [...new Set(D.moves.map((m) => m.part))]],
        ["gear", "全部器械", [...new Set(D.moves.flatMap((m) => m.gear))]],
        ["status", "全部上架状态", ["已上架", "已下架"]],
        ["auto", "排课资格", ["可排课", "未纳入"]],
        ["type", "全部动作类型", ["热身", "正式动作"]],
      ],
      "搜索动作 ID、名称或别名",
    )}${selected.size ? `<div class="selection-bar">已选 ${selected.size} 项 ${btn("批量下架", "bulk-off")}${btn("清空", "clear-selected")}</div>` : ""}${page(rows, ["选择", "动作", "部位 / 肌群", "器械", "类型", "可浏览", "自动排课", "版本 / 状态", "操作"], (m) => [`<input type="checkbox" aria-label="选择${esc(m.name)}" data-select="${m.id}" ${selected.has(m.id) ? "checked" : ""}>`, `<div class="cell-media"><img class="thumb" src="${esc(m.media?.cover || "/media/cover/" + m.id)}" alt=""><div>${link(m.name, "move/" + m.id)}<span class="sub mono">${m.id}</span></div></div>`, esc(m.part) + '<span class="sub">' + esc(m.muscle) + "</span>", esc(m.gear.join("、") || "徒手"), badge(m.warmup ? "热身" : "正式动作"), badge(m.visible ? "已上架" : "已下架"), badge(m.enabled ? "可排课" : "未纳入"), "v" + m.version + '<span class="sub">' + esc(m.status) + "</span>", link("查看 / 编辑", "move/" + m.id)], 12)}</section>`
  );
}
async function movePage() {
  const m = move(route().id);
  if (!m) return note("动作不存在");
  const v = m.draft || m,
    tab = route().params.get("tab") || "info";
  let body = "";
  if (tab === "info")
    body = `<div class="columns"><div>${section("基础资料与说明", `<form id="move-form" data-id="${m.id}"><div class="form-grid">${field("动作名称", "name", v.name)}${field("别名（逗号分隔）", "aliases", (v.aliases || []).join(","))}${field("训练部位", "part", v.part)}${field("目标肌群", "muscle", v.muscle)}</div><div class="top-space">${field("动作步骤（每行一步）", "steps", v.steps.join("\n"), "textarea")}</div><div class="top-space">${field("必需器械（逗号分隔）", "gear", v.gear.join(","))}</div><div class="top-space">${can("content.edit") ? '<button class="btn primary">保存草稿</button>' : ""}</div></form>`)}${section("视觉素材", `<div class="media-pair"><div><div class="frame"><img src="${esc(m.id.startsWith("N") ? m.media?.cover || "/brand.svg" : "/media/original/" + m.id)}" alt="原版参考"></div><div class="caption">原版参考 ${btn("暂停 / 播放", "motion:original")}</div></div><div><div class="frame"><img src="${esc(m.media?.animation || "/media/new/" + m.id)}" alt="当前动图"></div><div class="caption">当前动图 ${btn("暂停 / 播放", "motion:new")}</div></div></div>` + note("并排预览用于辅助核对；两个动图不保证逐帧同步。") + (can("content.edit") ? `<form id="media-form" class="top-space" data-id="${m.id}"><div class="form-grid"><label class="field">封面 WebP<input type="file" name="cover" accept="image/webp"></label><label class="field">动图 WebP<input type="file" name="animation" accept="image/webp"></label></div><button class="btn top-space">保存素材草稿</button></form>` : ""))}</div>${section(
      "当前发布信息",
      kv([
        ["稳定 ID", m.id],
        ["版本", "v" + m.version],
        ["审核", badge(m.status)],
        ["上架", badge(m.visible ? "已上架" : "已下架")],
        ["修改人", esc(m.by || "未记录")],
        ["修改时间", time(m.at)],
      ]) +
        `<div class="top-space">${can("content.publish") ? btn(m.visible ? "下架动作" : "重新上架", "move-toggle:" + m.id) : ""}</div>`,
    )}</div>`;
  if (tab === "scheduling")
    body = section(
      "自动排课属性",
      `<form id="schedule-form" data-id="${m.id}"><div class="form-grid">${select("动作模式", "pattern", ["", "蹲", "髋", "推", "拉", "核心", "辅助", "有氧", "热身"], v.pattern)}${select("难度", "level", ["基础", "进阶"], v.level)}${select("单位", "unit", ["次", "秒"], v.unit)}${field("目标次数 / 秒数", "target", v.target, "number")}${field("每次耗时（秒）", "seconds", v.seconds, "number")}${field("组间休息（秒）", "rest", v.rest, "number")}${field("替换候选动作 ID（逗号分隔）", "replacements", (v.replacements || []).join(","))}</div><label class="check"><input type="checkbox" name="approved" ${v.approved ? "checked" : ""}>已核对排课属性</label><label class="check"><input type="checkbox" name="enabled" ${v.enabled ? "checked" : ""}>参与自动排课</label>${can("content.edit") ? '<button class="btn primary">保存排课草稿</button>' : ""}</form>` +
        note("发布后影响新计划，用户已保存和完成的训练快照保留。"),
    );
  if (tab === "usage")
    body = section(
      "使用引用",
      table(
        ["类型", "用户 / 计划", "状态"],
        [
          ...favorites()
            .filter((f) => move(f.move)?.id === m.id)
            .map((f) => [
              "当前收藏",
              userLink(f.user),
              badge(m.visible ? "已上架" : "已下架"),
            ]),
          ...(D.users || []).flatMap((u) =>
            Object.values(u.sessions)
              .filter((s) => s.items.some((i) => move(i.id)?.id === m.id))
              .map((s) => [
                "训练课程",
                userLink(u.id) + " / " + esc(s.date),
                badge(s.status),
              ]),
          ),
        ],
      ),
    );
  if (tab === "versions") {
    const history = await call("move-history", { id: m.id });
    body =
      section(
        "草稿审核与发布",
        kv([
          ["当前版本", "v" + m.version],
          ["审核状态", badge(m.status)],
          ["草稿", m.draft ? "已保存" : "暂无"],
        ]) +
          `<div class="actions top-space">${m.draft && can("content.edit") ? btn("提交审核", "move-submit:" + m.id) : ""}${m.status === "待审核" && can("content.publish") ? btn("批准发布", "move-publish:" + m.id, "primary") + btn("退回修改", "move-reject:" + m.id) : ""}</div>` +
          (m.draft
            ? `<div class="top-space">${safeDiff(Object.fromEntries(Object.keys(m.draft).map((k) => [k, m[k]])), m.draft)}</div>`
            : ""),
      ) +
      section(
        "版本历史",
        table(
          ["版本", "时间 / 修改人", "原因", "操作"],
          history.map((h) => [
            "v" + h.version,
            time(h.at) + " / " + esc(h.actor),
            esc(h.reason),
            can("content.publish")
              ? btn("回退此版本", "move-rollback:" + h.version)
              : "—",
          ]),
        ),
      );
  }
  return (
    title(
      m.name,
      m.id + " · " + m.part + " · " + m.muscle,
      link("返回动作列表", "moves"),
    ) +
    tabs(
      [
        ["info", "资料与素材"],
        ["scheduling", "排课属性"],
        ["usage", "使用引用"],
        ["versions", "版本与发布"],
      ],
      "info",
    ) +
    body
  );
}
function taxonomyPage() {
  const kind = route().params.get("tab") || "部位",
    items =
      kind === "器械"
        ? [...new Set(D.moves.flatMap((m) => m.gear))]
        : [
            ...new Set(
              D.moves.map((m) => (kind === "部位" ? m.part : m.muscle)),
            ),
          ];
  for (const d of D.dictionaries || [])
    if (d.kind === kind && !items.includes(d.name)) items.push(d.name);
  const rows = filtered(
    items.map((name) => ({
      name,
      ...(D.dictionaries || []).find((d) => d.kind === kind && d.name === name),
    })),
    (d) => d.name,
  );
  return (
    title(
      "部位、肌群与器械",
      "维护别名与启用状态；有动作引用的分类不能直接停用。",
      can("content.edit") ? btn("新增分类", "tax-new") : "",
    ) +
    `<div class="tabs plain">${["部位", "肌群", "器械"].map((k) => link(k, "taxonomy?tab=" + k)).join("")}</div><section class="section">${filters()}${page(rows, ["名称", "别名", "关联动作", "启用状态", "版本", "操作"], (d) => [esc(d.name), esc((d.value?.aliases || []).join("、")), D.moves.filter((m) => (kind === "器械" ? m.gear.includes(d.name) : kind === "部位" ? m.part === d.name : m.muscle === d.name)).length, badge(d.value?.enabled === false ? "已停用" : "启用"), d.version || "初始目录", btn("编辑", "tax-edit:" + d.name)])}</section>`
  );
}
async function modulePage(module, heading) {
  if (!config[module]) config[module] = await api("admin/inspect", { module });
  const c = config[module],
    active = typeof c.active === "string" ? JSON.parse(c.active) : c.active,
    value = c.draft?.value ? JSON.parse(c.draft.value) : active;
  return (
    title(heading, "草稿保存、测试与审核发布分开执行。历史版本保留。") +
    section(
      "当前配置",
      `<form id="module-form" data-module="${module}">${module === "ai" ? `<div class="form-grid">${select("DeepSeek 模型", "model", ["deepseek-flash", "deepseek-v4-pro"], value.model)}${field("每日调用上限", "dailyLimit", value.dailyLimit, "number")}${field("普通输入 / 百万 Token（元）", "pricePerMillionInput", value.pricePerMillionInput, "number")}${field("输出 / 百万 Token（元）", "pricePerMillionOutput", value.pricePerMillionOutput, "number")}${field("缓存命中 / 百万 Token（元）", "pricePerMillionCache", value.pricePerMillionCache ?? value.pricePerMillionInput, "number")}${field("每日预算（元，留空不设金额限制）", "dailyBudget", value.dailyBudget ?? "", "number")}${field("每用户每日调用上限", "userDailyLimit", value.userDailyLimit ?? value.dailyLimit, "number")}${field("最大重试次数（0–2）", "maxRetries", value.maxRetries || 0, "number")}${field("超时（毫秒）", "timeoutMs", value.timeoutMs || 12000, "number")}${field("输入 Token 上限", "maxInputTokens", value.maxInputTokens || 8192, "number")}${field("输出 Token 上限", "maxOutputTokens", value.maxOutputTokens || 2048, "number")}</div><div class="top-space">${field("提示词", "prompt", value.prompt, "textarea")}</div>` : module === "templates" ? templateFields(value) : field("版本内容", "value", JSON.stringify(value, null, 2), "textarea")}<div class="actions top-space"><button class="btn primary">保存草稿</button>${btn("使用固定条件试算", "trial:" + module)}${module === "ai" && can("ai.credentials") ? btn("轮换 API Key", "key") : ""}</div></form>` +
        note(
          "v" +
            c.version +
            " · " +
            (c.draft?.status || "无草稿") +
            (module === "ai"
              ? "。预算为请求控制值，服务商账单回补可能产生差异。"
              : "。发布只影响新的业务记录。"),
        ),
    ) +
    section(
      "审核与版本",
      `<div class="actions">${c.draft ? btn("提交草稿审核", "module-submit:" + module) : ""}${c.draft?.status === "待审核" ? btn("批准发布", "module-publish:" + module, "primary") + btn("退回修改", "module-reject:" + module) : ""}</div>` +
        table(
          ["版本", "操作"],
          (c.history || []).map((h) => [
            h,
            btn("查看与回退", "module-rollback:" + module + ":" + h),
          ]),
        ),
    )
  );
}
function generationsPage() {
  const rows = filtered(A.generations, (g) => g.id + g.user + g.scene, {
    status: (g) => g.status,
    environment: (g) => g.environment,
    adoption: (g) => g.adoption,
  });
  return (
    title(
      "生成记录",
      "一次业务生成关联全部真实调用；失败、重试和未采用结果均保留。",
    ) +
    `<section class="section">${filters([
      ["status", "全部结果", ["成功交付", "规则回退", "处理中", "待核对"]],
      ["environment", "全部环境", ["production", "test"]],
      ["adoption", "采用情况", ["未采用", "已保存", "修改后保存", "未知"]],
    ])}${page(rows, ["生成 ID / 时间", "用户 / 触发者", "场景", "结果", "模型 / 配置", "调用次数", "采用情况", "费用"], (g) => [link(g.id, "generation/" + g.id) + '<span class="sub">' + time(g.at) + "</span>", userLink(g.user), esc(g.scene), badge(g.status), esc(g.config.model) + '<span class="sub">v' + g.config.version + "</span>", callsOf(g.id).length, badge(g.adoption), costCell(callsOf(g.id))])}</section>`
  );
}
function generationPage() {
  const g = A.generations.find((g) => g.id === route().id);
  if (!g) return note("记录不存在或无权查看");
  const cs = callsOf(g.id),
    p = prices(cs),
    tab = route().params.get("tab") || "overview";
  let body = "";
  if (tab === "overview")
    body = section(
      "生成概况",
      kv([
        ["场景", esc(g.scene)],
        ["环境", esc(g.environment)],
        ["结果", badge(g.status)],
        ["发起", time(g.at)],
        ["结束", time(g.ended)],
        ["用户", userLink(g.user)],
        ["原因", esc(g.error || "—")],
        [
          "关联原生成",
          g.parent ? link(g.parent, "generation/" + g.parent) : "无",
        ],
        ["采用", badge(g.adoption)],
      ]),
    );
  if (["input", "output"].includes(tab))
    body = section(
      tab === "input" ? "输入快照" : "交付输出",
      detail[g.id]
        ? pre(detail[g.id][tab])
        : note("查看详细输入输出需要单独授权并留下访问原因。") +
            (can("ai.sensitive") ? btn("授权查看", "reveal-ai:" + g.id) : ""),
    );
  if (tab === "calls")
    body = section(
      "调用时间线",
      table(
        ["调用", "序号", "发起时间", "结果", "费用"],
        cs.map((c) => [
          link(c.id, "call/" + c.id),
          c.seq,
          time(c.at),
          badge(c.result),
          costCell([c]),
        ]),
      ),
    );
  if (tab === "adoption")
    body = section(
      "用户后续行为",
      kv([
        ["采用情况", badge(g.adoption)],
        ["保存对象", esc(g.object || "未保存 / 未关联")],
      ]),
    );
  return (
    title(
      "生成详情",
      g.id,
      can("ai.test") ? btn("重放为测试请求", "replay:" + g.id) : "",
    ) +
    (can("ai.cost")
      ? `<div class="price-hero"><div><small>已确认费用</small><div class="value">${money(p.confirmed)}</div></div><div><small>待确认估算</small><div class="value orange">${money(p.pending)}</div></div><div><small>计费完整度</small><div class="value">${p.unknown} 笔未知</div><small>${cs.length} 次实际调用</small></div></div>`
      : "") +
    tabs(
      [
        ["overview", "概况"],
        ["input", "输入"],
        ["output", "输出"],
        ["calls", "调用时间线"],
        ["adoption", "用户后续行为"],
      ],
      "overview",
    ) +
    body
  );
}
const callRows = () =>
  A.calls.map((c) => ({
    ...c,
    user: A.generations.find((g) => g.id === c.generation)?.user,
    environment: A.generations.find((g) => g.id === c.generation)?.environment,
    scene: A.generations.find((g) => g.id === c.generation)?.scene,
  }));
function callsPage() {
  if (!can("ai.cost")) return note("当前账号无权查看费用明细");
  const rows = filtered(
    callRows(),
    (c) => c.id + c.generation + c.user + c.model,
    {
      billing: (c) => c.billing,
      environment: (c) => c.environment,
      model: (c) => c.model,
      scene: (c) => c.scene,
    },
  );
  return (
    title(
      "调用与消费明细",
      "确认金额、待确认估算与未知费用分别列示。",
      can("ai.export") ? btn("导出筛选结果", "export:ai") : "",
    ) +
    `<section class="section">${filters([
      ["billing", "全部计费状态", ["未获得用量", "仅估算", "账单确认"]],
      ["environment", "全部环境", ["production", "test"]],
      ["model", "全部模型", [...new Set(A.calls.map((c) => c.model))]],
      ["scene", "全部场景", [...new Set(A.generations.map((g) => g.scene))]],
    ])}${page(rows, ["调用 / 时间", "生成 / 用户", "模型 / 序号", "结果", "输入 / 输出 Token", "确认费用", "待确认估算", "计费状态"], (c) => [link(c.id, "call/" + c.id) + '<span class="sub">' + time(c.at) + "</span>", link(c.generation, "generation/" + c.generation) + '<span class="sub">' + userLink(c.user) + "</span>", esc(c.model) + " / " + c.seq, badge(c.result), (c.usage?.prompt_tokens ?? "待回补") + " / " + (c.usage?.completion_tokens ?? "待回补"), c.confirmed == null ? "未确认" : money(c.confirmed), c.confirmed != null ? "—" : money(c.estimate), badge(c.billing)])}</section>`
  );
}
function callPage() {
  if (!can("ai.cost")) return note("当前账号无权查看费用");
  const c = A.calls.find((c) => c.id === route().id);
  if (!c) return note("调用不存在或无权查看");
  return (
    title(
      "调用消费详情",
      c.id,
      link("关联生成", "generation/" + c.generation),
    ) +
    section(
      "本次费用",
      kv([
        ["确认费用", c.confirmed == null ? "未确认" : money(c.confirmed)],
        ["原始估算", money(c.estimate)],
        ["计费状态", badge(c.billing)],
        ["调用状态", badge(c.result)],
        ["发起时间", time(c.at)],
        ["结束时间", time(c.ended)],
        ["服务商请求 ID", esc(c.provider_id || "未返回")],
        ["保留额度", money(c.reserve)],
        ["错误原因", esc(c.error || "无")],
      ]) +
        `<div class="actions top-space">${btn("关联本次账单", "bill:" + c.id)}${btn("回补用量", "usage:" + c.id)}</div>`,
    ) +
    section(
      "当次用量与价格依据",
      kv([
        [
          "普通输入 Token",
          c.usage
            ? String(
                (c.usage.prompt_tokens || 0) -
                  (c.usage.prompt_cache_hit_tokens || 0),
              )
            : "待回补",
        ],
        ["缓存命中 Token", c.usage?.prompt_cache_hit_tokens ?? "未提供"],
        ["输出 Token", c.usage?.completion_tokens ?? "待回补"],
      ]) +
        pre(
          c.price || {
            说明: "旧系统未保存价格快照；保留原估算，不按新价格重算",
          },
        ),
    ) +
    section(
      "关联账单",
      table(
        ["账单行", "周期", "金额", "来源", "确认时间"],
        A.bills
          .filter((b) => b.call_id === c.id)
          .map((b) => [
            esc(b.id),
            esc(b.period),
            money(b.amount),
            esc(b.source),
            time(b.at),
          ]),
      ),
    )
  );
}
function costsPage() {
  if (!can("ai.cost")) return note("当前账号无权查看费用");
  const rows = filtered(callRows(), (c) => c.model + c.user, {
      environment: (c) => c.environment,
      scene: (c) => c.scene,
    }),
    p = prices(rows),
    days = [...new Set(rows.map((c) => localDay(c.at)))].sort().reverse(),
    models = [...new Set(rows.map((c) => c.model))];
  return (
    title(
      "费用统计",
      "汇总仅对调用明细求和；跨日调用按发起日归属，周期账单单独显示。",
      btn("登记周期账单", "period-bill"),
    ) +
    filters([
      ["environment", "全部环境", ["production", "test"]],
      ["scene", "全部场景", [...new Set(A.generations.map((g) => g.scene))]],
    ]) +
    summary([
      ["确认费用", money(p.confirmed), "可归属调用的账单金额"],
      ["待确认估算", money(p.pending), "不代表实际扣费"],
      ["未知费用", p.unknown + " 笔", "含超时与用量待回补"],
      ["实际调用", rows.length, "生成汇总不重复相加"],
    ]) +
    generationAverage() +
    section(
      "按日统计",
      table(
        ["日期", "调用数", "确认费用", "待确认估算", "未知"],
        days.map((d) => {
          const cs = rows.filter((c) => localDay(c.at) === d),
            p = prices(cs);
          return [
            link(d, costPath({ from: d, to: d })),
            cs.length,
            money(p.confirmed),
            money(p.pending),
            p.unknown,
          ];
        }),
      ),
    ) +
    section(
      "按模型",
      table(
        ["模型", "调用数", "费用"],
        models.map((m) => [
          link(m, costPath({ model: m })),
          rows.filter((c) => c.model === m).length,
          costCell(rows.filter((c) => c.model === m)),
        ]),
      ),
    ) +
    section(
      "按用户 / 触发者",
      table(
        ["用户", "调用数", "费用"],
        [...new Set(rows.map((c) => c.user))].map((u) => [
          userLink(u),
          rows.filter((c) => c.user === u).length,
          costCell(rows.filter((c) => c.user === u)),
        ]),
      ),
    ) +
    section(
      "独立周期账单",
      note("无法归属单次调用的账单只确认周期金额，不与调用汇总再次相加。") +
        table(
          ["账单行", "周期", "金额", "来源"],
          A.bills
            .filter((b) => !b.call_id)
            .map((b) => [
              esc(b.id),
              esc(b.period),
              money(b.amount),
              esc(b.source),
            ]),
        ),
    )
  );
}
function staffPage() {
  return (
    title(
      "管理人员",
      "独立账号、多角色授权；停用或撤权立即使会话失效。",
      btn("新建管理员", "staff-new"),
    ) +
    `<section class="section">${filters([["enabled", "启用状态", ["启用", "已停用"]]])}${page(
      filtered(D.staff || [], (a) => a.name + a.display + a.roles.join(""), {
        enabled: (a) => (a.enabled ? "启用" : "已停用"),
      }),
      ["姓名 / 账号", "角色", "状态", "数据范围", "创建 / 最近登录", "操作"],
      (a) => [
        esc(a.display) + '<span class="sub">' + esc(a.name) + "</span>",
        esc(a.roles.join("、")),
        badge(a.enabled ? "启用" : "已停用"),
        esc(
          (a.scope.users === "all"
            ? "全部用户"
            : a.scope.users === "assigned"
              ? "关联个案"
              : a.scope.users.length + " 位指定用户") +
            " · " +
            ({ all: "全部环境", production: "正式环境", test: "测试环境" }[
              a.scope.environment
            ] || a.scope.environment),
        ) +
          '<span class="sub">' +
          esc(a.scope.scenes?.join("、") || "全部业务场景") +
          "</span>",
        time(a.created) + '<span class="sub">' + time(a.last) + "</span>",
        btn("编辑", "staff-edit:" + a.name) +
          btn(a.enabled ? "停用" : "启用", "staff-state:" + a.name) +
          btn("强制退出", "staff-logout:" + a.name),
      ],
    )}</section>`
  );
}
const permissionLabels = {
  "overview.view": "运营概览",
  "users.view": "用户业务记录",
  "users.sensitive": "身体与过敏资料",
  "users.manage": "限制与恢复账号",
  "users.export": "导出用户业务",
  "content.view": "动作与规则查看",
  "content.edit": "内容草稿编辑",
  "content.publish": "审核、发布与回退",
  "content.export": "导出动作目录",
  "ai.view": "AI 生成摘要",
  "ai.sensitive": "AI 详细输入输出",
  "ai.cost": "精确费用与账单核对",
  "ai.edit": "模型与提示词编辑",
  "ai.test": "真实调用测试与重放",
  "ai.publish": "AI 配置发布与回退",
  "ai.credentials": "AI 凭据轮换",
  "ai.export": "AI 记录导出",
  "admin.manage": "管理员与权限配置",
  "logs.view": "操作日志",
};
function rolesPage() {
  const name = route().params.get("name") || D.roleDefs?.[0]?.name,
    role = D.roleDefs?.find((r) => r.name === name);
  return (
    title(
      "角色与权限",
      "菜单、操作、敏感字段由服务端校验；数据范围在管理员账号中单独分配。",
      btn("新建角色", "role-new"),
    ) +
    `<div class="role-layout"><section class="section">${(D.roleDefs || []).map((r) => `<a class="role-item ${r.name === name ? "on" : ""}" href="#/roles?name=${encodeURIComponent(r.name)}"><b>${esc(r.name)}</b><small>${r.permissions.length} 项权限</small></a>`).join("")}</section>${section("权限明细", role ? `<form id="role-form" data-name="${esc(name)}"><div class="permission-grid">${D.permissionKeys.map((k) => `<label class="check"><input name="permission" type="checkbox" value="${k}" ${role.permissions.includes(k) ? "checked" : ""} ${name === "管理员" ? "disabled" : ""}>${esc(permissionLabels[k] || k)}</label>`).join("")}</div>${name !== "管理员" ? '<button class="btn primary">比较权限变更</button>' : note("超级管理员保留完整授权。至少保留一名启用账号。")}</form>` : "尚无角色")}</div>` +
    section(
      "微信小程序登录",
      note("AppSecret 只在服务器加密保存；不会显示原值。") +
        btn("查看配置状态", "wechat-status") +
        btn("轮换 AppSecret", "wechat-key"),
    )
  );
}
function logsPage() {
  const rows = filtered(
    D.logs || [],
    (e) => e.id + e.actor + e.action + e.object + e.reason,
    { result: (e) => e.result },
  );
  return (
    title(
      "操作日志",
      "记录登录、修改、导出、敏感读取、拒绝与冲突；不提供删除入口。",
    ) +
    `<section class="section">${filters([["result", "全部结果", ["成功", "失败", "拒绝"]]])}${page(rows, ["日志 / 时间", "操作人 / 当时角色", "操作", "对象", "结果", "原因", "详情"], (e) => [esc(e.id) + '<span class="sub">' + time(e.at) + "</span>", esc(e.actor) + '<span class="sub">' + esc(e.roles.join("、")) + "</span>", esc(e.action), esc(e.object), badge(e.result), esc(e.reason), btn("前后差异", "log:" + e.id)])}</section>`
  );
}
function overviewPage() {
  const us = D.users || [],
    gs = A.generations,
    p = prices(A.calls);
  return (
    title(
      "运营概览",
      "当前账号数据与已发生的业务记录；时间范围可在各明细页继续筛选。",
    ) +
    summary([
      ["账号", us.length, "已同步账号", "users"],
      ["当前收藏", favorites().length, "用户—动作有效关系", "favorites"],
      ["已保存计划", plans().length, "按计划 ID 去重", "plans"],
      [
        "完成训练",
        us.reduce((n, u) => n + u.history.length, 0),
        "实际完成课程",
        "plans",
      ],
    ]) +
    summary([
      ["AI 生成", gs.length, "业务请求数", "generations"],
      ["实际调用", A.calls.length, "包含失败与重试", "calls"],
      [
        "确认费用",
        can("ai.cost") ? money(p.confirmed) : "无权限",
        "可归属账单",
        "costs",
      ],
      [
        "未知费用",
        can("ai.cost") ? p.unknown : "无权限",
        "保留待核对记录",
        "calls",
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
            link("查看动作", "moves"),
          ],
          [
            "失败或待核对生成",
            gs.filter((g) => g.status !== "成功交付").length,
            link("查看生成", "generations"),
          ],
        ],
      ),
    )
  );
}
const views = {
  overview: overviewPage,
  users: usersPage,
  user: userPage,
  favorites: favoritesPage,
  plans: plansPage,
  plan: planPage,
  meals: mealsPage,
  meal: mealPage,
  moves: movesPage,
  move: movePage,
  taxonomy: taxonomyPage,
  templates: () => modulePage("templates", "训练模板与规则"),
  generations: generationsPage,
  generation: generationPage,
  calls: callsPage,
  call: callPage,
  costs: costsPage,
  config: () => modulePage("ai", "模型与生成配置"),
  staff: staffPage,
  roles: rolesPage,
  logs: logsPage,
};

function templateFields(v) {
  return `<label class="check"><input type="checkbox" name="enabled" ${v.enabled ? "checked" : ""}>启用系统排课</label><h2>每周训练日</h2><p class="muted">1–7 表示周一至周日；用逗号分隔。5–7 天仍按已确认规则自行编排。</p><div class="form-grid top-space">${v.dates.map((days, i) => field(i + 1 + " 天计划", "dates" + i, days.map((d) => d + 1).join(","))).join("")}</div><h2 class="top-space">课程动作模式</h2><div class="form-grid top-space">${Object.entries(
    v.patterns,
  )
    .map(([k, a]) => field(k, "pattern-" + k, a.join(",")))
    .join(
      "",
    )}</div><h2 class="top-space">目标与组数</h2><div class="form-grid top-space">${Object.entries(
    v.sets,
  )
    .map(([k, n]) => field(k, "sets-" + k, n, "number"))
    .join("")}</div>`;
}

function generationAverage() {
  const f = filtersState.costs || {},
    gs = A.generations.filter(
      (g) =>
        (!f.environment || g.environment === f.environment) &&
        (!f.scene || g.scene === f.scene) &&
        (!f.user || g.user === f.user) &&
        (!f.q ||
          (g.config.model + g.user)
            .toLowerCase()
            .includes(f.q.toLowerCase())) &&
        (!f.from || localDay(g.at) >= f.from) &&
        (!f.to || localDay(g.at) <= f.to),
    ),
    ids = new Set(gs.map((g) => g.id)),
    cs = A.calls.filter((c) => ids.has(c.generation)),
    sum = prices(cs),
    success = gs.filter((g) => g.status === "成功交付").length;
  return section(
    "平均成功生成成本",
    kv([
      ["成功交付", success],
      ["全部生成费用（含失败与跨日重试）", money(sum.confirmed + sum.pending)],
      [
        "平均成本",
        success
          ? money((sum.confirmed + sum.pending) / success)
          : "暂无成功生成",
      ],
    ]) +
      note(
        "按所选周期发起的生成归属，纳入其全部关联调用；" +
          (sum.unknown
            ? "存在未知费用，估算不完整。"
            : "待确认金额为估算，不等于账单实收。"),
      ),
  );
}
