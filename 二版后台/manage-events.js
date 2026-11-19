"use strict";
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const [a, ...rest] = el.dataset.action.split(":"),
    v = rest.join(":");
  try {
    if (a === "close") {
      $("#dialog").close();
      return;
    }
    if (a === "logout") {
      await api("admin/logout");
      sessionStorage.removeItem("lianna.admin");
      token = "";
      $("#workspace").hidden = true;
      $("#login").hidden = false;
      return;
    }
    if (a === "reset") {
      filtersState[route().page] = {};
      location.hash = "/" + route().page;
      await render();
      return;
    }
    if (a === "page") {
      filtersState[route().page] = {
        ...filtersState[route().page],
        page: Number(v),
      };
      await render();
      return;
    }
    if (a === "move-new") {
      modal(
        "新增动作草稿",
        field("动作名称", "name") +
          field("训练部位", "part", "全身") +
          field("目标肌群", "muscle") +
          field("步骤（每行一步）", "steps", "", "textarea"),
        async (f) => {
          const r = await call("move-new", {
            name: f.get("name"),
            part: f.get("part"),
            muscle: f.get("muscle"),
            steps: f.get("steps").split("\n").filter(Boolean),
          });
          await refresh();
          location.hash = "/move/" + r.id;
        },
      );
      return;
    }
    if (a === "move-import") {
      modal(
        "导入动作草稿",
        note(
          "按稳定动作 ID 更新资料，最多100条；仅保存草稿，需另行审核发布。",
        ) +
          field("JSON 动作数组", "value", "[]", "textarea") +
          field("导入原因", "reason"),
        async (f) => {
          const rows = JSON.parse(f.get("value"));
          if (!Array.isArray(rows) || rows.length > 100)
            throw Error("请输入不超过100条的数组");
          const results = [];
          for (const row of rows) {
            try {
              const m = move(row.id);
              if (!m) throw Error("动作ID不存在，请先新增");
              await call("move-draft", {
                id: m.id,
                base: m.version,
                value: { ...m, ...row },
                reason: f.get("reason"),
              });
              results.push([row.id, "成功"]);
            } catch (e) {
              results.push([row.id, e.message]);
            }
          }
          await refresh();
          modal(
            "逐条导入结果",
            table(
              ["动作", "结果"],
              results.map((r) => r.map(esc)),
            ),
          );
        },
      );
      return;
    }
    if (a === "clear-selected") {
      selected.clear();
      await render();
      return;
    }
    if (a === "reveal-user") {
      confirm(
        "授权查看敏感资料",
        note("记录读取对象和字段；资料原值不会写入普通操作日志。"),
        async (reason) => {
          detail[v] = await call("user", { id: v, sensitive: true, reason });
          await render();
        },
      );
      return;
    }
    if (a === "reveal-ai") {
      confirm(
        "授权查看 AI 输入输出",
        note("会记录本次访问原因。"),
        async (reason) => {
          detail[v] = await ledger("detail", { id: v, reason });
          await render();
        },
      );
      return;
    }
    if (a === "user-status") {
      const u = user(v);
      confirm(
        u.status === "正常" ? "限制账号" : "恢复账号",
        note(
          "限制后禁止新登录与业务写入，现有会话立即失效。历史记录保留。",
          true,
        ),
        async (reason) => {
          await call("user-status", {
            id: v,
            status: u.status === "正常" ? "已限制" : "正常",
            reason,
          });
          await refresh();
        },
      );
      return;
    }
    if (a === "note") {
      modal(
        "内部处理备注",
        field("备注", "note", user(v).note, "textarea") +
          field("操作原因", "reason"),
        async (f) => {
          await call("user-note", {
            id: v,
            note: f.get("note"),
            reason: f.get("reason"),
          });
          await refresh();
        },
      );
      return;
    }
    if (
      a === "move-toggle" ||
      a === "move-publish" ||
      a === "move-reject" ||
      a === "move-rollback"
    ) {
      const m = move(route().id),
        action = a === "move-toggle" ? "move-status" : a;
      confirm(
        el.textContent,
        note("检查当前对象、基线版本和影响范围。旧收藏及训练记录保留。", true) +
          kv([
            ["动作", esc(m.name)],
            ["当前版本", "v" + m.version],
            ["目标", esc(v)],
          ]),
        async (reason) => {
          await call(action, {
            id: m.id,
            base: m.version,
            visible: !m.visible,
            version: Number(v),
            reason,
          });
          await refresh();
        },
      );
      return;
    }
    if (a === "move-submit") {
      await call("move-submit", { id: v });
      await refresh();
      toast("已提交审核");
      return;
    }
    if (a === "bulk-off") {
      const ids = [...selected];
      confirm(
        "批量下架 " + ids.length + " 个动作",
        note(
          ids
            .slice(0, 5)
            .map((id) => move(id).name)
            .join("、") + "；保留历史引用。",
          true,
        ),
        async (reason) => {
          const result = await call("move-bulk", {
            ids,
            visible: false,
            reason,
          });
          selected.clear();
          await refresh();
          modal(
            "逐条处理结果",
            table(
              ["动作", "结果"],
              result.results.map((x) => [
                esc(x.id),
                x.ok ? "成功" : esc(x.error),
              ]),
            ),
          );
        },
      );
      return;
    }
    if (a === "motion") {
      const imgs = $$(".media-pair img"),
        img = imgs[v === "original" ? 0 : 1];
      if (img.dataset.paused) {
        img.src = img.dataset.originalSrc;
        delete img.dataset.paused;
      } else {
        img.dataset.originalSrc = img.src;
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        img.src = c.toDataURL();
        img.dataset.paused = "1";
      }
      return;
    }
    if (a === "tax-new" || a === "tax-edit") {
      const kind = route().params.get("tab") || "部位",
        d = (D.dictionaries || []).find((x) => x.kind === kind && x.name === v);
      modal(
        "维护" + kind,
        field("名称", "name", v) +
          field(
            "别名（逗号分隔）",
            "aliases",
            (d?.value.aliases || []).join(","),
          ) +
          select(
            "状态",
            "enabled",
            ["启用", "停用"],
            d?.value.enabled === false ? "停用" : "启用",
          ) +
          field("原因", "reason"),
        async (f) => {
          await call("taxonomy-save", {
            kind,
            name: f.get("name"),
            base: d?.version || 0,
            value: {
              aliases: f.get("aliases").split(",").filter(Boolean),
              enabled: f.get("enabled") === "启用",
            },
            reason: f.get("reason"),
          });
          await refresh();
        },
      );
      return;
    }
    if (a === "module-submit") {
      await api("admin/submit", { module: v, id: config[v].draft.id });
      await refresh();
      return;
    }
    if (a === "module-publish" || a === "module-reject") {
      confirm(
        el.textContent,
        note("发布影响之后的新请求；已有业务快照和历史价格保持原版本。"),
        async (reason) => {
          await api(
            "admin/" + (a === "module-publish" ? "publish" : "reject"),
            { module: v, id: config[v].draft.id, reason },
          );
          await refresh();
        },
      );
      return;
    }
    if (a === "module-rollback") {
      const [mod, version] = v.split(":");
      confirm(
        "回退配置版本",
        note("目标版本 v" + version + "；当前基线 v" + config[mod].version),
        async (reason) => {
          await api("admin/rollback", {
            module: mod,
            base: config[mod].version,
            version: Number(version),
            reason,
          });
          await refresh();
        },
      );
      return;
    }
    if (a === "trial") {
      const c = config[v],
        value = c.draft ? JSON.parse(c.draft.value) : c.active,
        sample =
          v === "templates"
            ? {
                goal: "增肌",
                days: 3,
                minutes: 30,
                start: new Date().toISOString().slice(0, 10),
                gear: ["哑铃"],
                experience: "基础",
              }
            : v === "ai"
              ? { index: 1, profile: { allergies: [], avoid: [] } }
              : {
                  profile: {
                    sex: "女",
                    height: 165,
                    weight: 62.5,
                    targets: { kcal: 2000 },
                    ratios: [30, 40, 30],
                    allergens: [],
                    avoid: [],
                  },
                  index: 1,
                  items: [],
                };
      modal(
        "固定条件试算",
        field(
          "测试输入",
          "sample",
          JSON.stringify(sample, null, 2),
          "textarea",
        ) +
          (v === "ai"
            ? note(
                "将发起真实 DeepSeek 调用并产生费用，结果记为后台测试。",
                true,
              )
            : note("试算不写回用户记录。")),
        async (f) => {
          const r = await api("preview/draft", {
            module: v,
            value,
            sample: JSON.parse(f.get("sample")),
          });
          await load();
          modal("试算结果", pre(r));
        },
      );
      return;
    }
    if (a === "replay") {
      confirm(
        "重放为后台测试",
        note(
          "使用当前发布版本产生新的付费调用，不覆盖原生成或用户结果。",
          true,
        ),
        async (reason) => {
          const result = await api("admin/replay", {
            id: v,
            requestId: crypto.randomUUID(),
            reason,
          });
          await refresh();
          location.hash = "/generation/" + result.generationId;
        },
      );
      return;
    }
    if (a === "key" || a === "wechat-key") {
      modal(
        a === "key" ? "轮换 DeepSeek API Key" : "轮换微信 AppSecret",
        note("凭据只在服务端加密保存，不在页面回显。") +
          field("新凭据", "key", "", "password"),
        async (f) => {
          await api("admin/" + a, { key: f.get("key") });
          toast("已加密保存");
        },
      );
      return;
    }
    if (a === "wechat-status") {
      const s = await api("admin/wechat-status");
      modal(
        "微信小程序配置",
        kv([
          ["AppID", esc(s.appId)],
          ["AppSecret", s.configured ? "已配置" : "未配置"],
        ]),
      );
      return;
    }
    if (a === "staff-new" || a === "staff-edit") {
      const s = D.staff.find((s) => s.name === v);
      modal(
        s ? "编辑管理员" : "新建管理员",
        `<div class="form-grid">${field("姓名 / 显示名", "display", s?.display)}${field("登录账号", "name", s?.name)}${field("新密码（至少12位；编辑留空不改）", "password", "", "password")}${select("数据范围", "scope", ["全部用户", "指定用户", "关联个案"], s?.scope.users === "all" ? "全部用户" : Array.isArray(s?.scope.users) ? "指定用户" : "关联个案")}${select("环境", "environment", ["all", "production", "test"], s?.scope.environment || "all")}${field("指定用户 ID（逗号分隔）", "users", Array.isArray(s?.scope.users) ? s.scope.users.join(",") : "")}</div><label class="field top-space">角色</label>${multi(
          "roles",
          D.roleDefs.map((r) => r.name),
          s?.roles || [],
        )}${field("业务场景（留空表示全部）", "scenes", (s?.scope.scenes || []).join(","))}${field("授权原因", "reason")}`,
        async (f) => {
          await call("staff-save", {
            name: f.get("name"),
            display: f.get("display"),
            password: f.get("password"),
            roles: f.getAll("roles"),
            scope: {
              users:
                f.get("scope") === "全部用户"
                  ? "all"
                  : f.get("scope") === "关联个案"
                    ? "assigned"
                    : f
                        .get("users")
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
              scenes: f.get("scenes").split(",").filter(Boolean),
              environment: f.get("environment"),
            },
            reason: f.get("reason"),
          });
          await refresh();
        },
      );
      return;
    }
    if (a === "staff-state" || a === "staff-logout") {
      const s = D.staff.find((s) => s.name === v);
      confirm(
        el.textContent,
        note(
          "对象：" + s.display + " / " + s.name + "。现有登录会话将失效。",
          true,
        ),
        async (reason) => {
          await call(a, { name: v, enabled: !s.enabled, reason });
          await refresh();
        },
      );
      return;
    }
    if (a === "role-new") {
      modal(
        "新建角色",
        field("角色名", "name") + field("原因", "reason"),
        async (f) => {
          await call("role-save", {
            name: f.get("name"),
            permissions: [],
            reason: f.get("reason"),
          });
          await refresh();
          location.hash = "/roles?name=" + encodeURIComponent(f.get("name"));
        },
      );
      return;
    }
    if (a === "bill" || a === "period-bill") {
      modal(
        a === "bill" ? "关联本次调用账单" : "登记周期总账单",
        note(
          a === "bill"
            ? "仅登记服务商可归属此请求的金额；不能将周期总额冒充本次实收。"
            : "只确认周期金额，单次调用仍保持估算。",
          true,
        ) +
          field("服务商账单行 ID", "billId") +
          field("账单周期", "period", new Date().toISOString().slice(0, 10)) +
          field("确认金额（人民币元）", "amount", "", "number") +
          field("来源 / 依据", "source") +
          field("核对原因", "reason"),
        async (f) => {
          await ledger(a, {
            id: v,
            billId: f.get("billId"),
            period: f.get("period"),
            amount: f.get("amount"),
            currency: "CNY",
            source: f.get("source"),
            reason: f.get("reason"),
          });
          await refresh();
        },
      );
      return;
    }
    if (a === "usage") {
      modal(
        "回补服务商用量",
        field("输入 Token", "input", "", "number") +
          field("输出 Token", "output", "", "number") +
          field("缓存命中 Token", "cache", 0, "number") +
          field("核对依据与原因", "reason"),
        async (f) => {
          await ledger("usage", {
            id: v,
            usage: {
              prompt_tokens: Number(f.get("input")),
              completion_tokens: Number(f.get("output")),
              prompt_cache_hit_tokens: Number(f.get("cache")),
            },
            reason: f.get("reason"),
          });
          await refresh();
        },
      );
      return;
    }
    if (a === "log") {
      const l = D.logs.find((l) => l.id === v);
      modal(
        "操作前后差异",
        kv([
          ["操作人", esc(l.actor)],
          ["时间", time(l.at)],
          ["结果", badge(l.result)],
          ["原因", esc(l.reason)],
          ["请求 ID", esc(l.request)],
          ["来源", esc(l.ip)],
        ]) + safeDiff(l.before, l.after),
      );
      return;
    }
    if (a === "export") {
      confirm(
        "导出筛选结果",
        note("只导出当前授权范围内的记录，并记录导出日志。"),
        async (reason) => {
          if (v === "ai") {
            const ids = filtered(
              callRows(),
              (c) => c.id + c.generation + c.user + c.model,
              {
                billing: (c) => c.billing,
                environment: (c) => c.environment,
                model: (c) => c.model,
              },
            ).map((c) => c.id);
            const r = await ledger("export", { ids, reason });
            download(
              [
                ["调用", "生成", "发起", "模型", "估算", "确认", "状态"],
                ...r.calls.map((c) => [
                  c.id,
                  c.generation,
                  c.at,
                  c.model,
                  c.estimate,
                  c.confirmed,
                  c.billing,
                ]),
              ],
              "AI调用明细",
            );
          } else {
            const rows =
              v === "moves"
                ? filtered(D.moves, (m) => m.id + m.name, moveFilter)
                : filtered(D.users, (u) => u.id + u.name, {
                    status: (u) => u.status,
                  });
            const r = await call("export", {
              module: v,
              ids: rows.map((x) => x.id),
              reason,
            });
            download(
              [
                ["编号", "名称", "状态"],
                ...r.rows.map((x) => [x.id, x.name, x.status]),
              ],
              v,
            );
          }
          await load();
        },
      );
      return;
    }
    if (a === "search") {
      modal("查找用户、动作或记录", field("名称或编号", "query"), async (f) => {
        const q = f.get("query").trim(),
          matches = [
            ...(D.users || [])
              .filter((u) => (u.id + u.name).includes(q))
              .map((u) => link(u.name, "user/" + u.id)),
            ...(D.moves || [])
              .filter((m) => (m.id + m.name).includes(q))
              .slice(0, 20)
              .map((m) => link(m.name, "move/" + m.id)),
            ...A.generations
              .filter((g) => g.id.includes(q))
              .map((g) => link(g.id, "generation/" + g.id)),
            ...A.calls
              .filter((c) => c.id.includes(q))
              .map((c) => link(c.id, "call/" + c.id)),
          ];
        modal(
          "查找结果",
          matches.length
            ? matches
                .map((x) => '<div class="line-row">' + x + "</div>")
                .join("")
            : note("没有匹配记录"),
        );
      });
      return;
    }
    if (a === "food-config") {
      modal(
        "食材与营养规则",
        btn("食材版本", "open-module:foods") +
          btn("营养规则", "open-module:nutrition"),
      );
      return;
    }
    if (a === "open-module") {
      $("#dialog").close();
      $("#app").innerHTML = await modulePage(
        v,
        v === "foods" ? "食材资料" : "营养规则",
      );
      return;
    }
    if (a === "meal-recalc") {
      modal(
        "饮食复算",
        field(
          "复算输入",
          "sample",
          JSON.stringify(
            {
              profile: {
                sex: "女",
                height: 165,
                weight: 62.5,
                targets: { kcal: 2000 },
                ratios: [30, 40, 30],
                allergens: [],
                avoid: [],
              },
              index: 1,
              items: [],
            },
            null,
            2,
          ),
          "textarea",
        ) + note("请填写需验证的条件；不会修改用户原记录。"),
        async (f) => {
          const r = await api("preview/meal", JSON.parse(f.get("sample")));
          modal("复算结果", pre(r));
        },
      );
      return;
    }
  } catch (error) {
    toast(error.message);
  }
});
document.addEventListener("change", (e) => {
  if (e.target.matches("[data-select]")) {
    e.target.checked
      ? selected.add(e.target.dataset.select)
      : selected.delete(e.target.dataset.select);
    render();
  }
  const multi = e.target.closest(".multi");
  if (multi)
    multi.querySelector("summary").textContent =
      "已选 " +
      multi.querySelectorAll("input:checked").length +
      " 项 · 下拉多选";
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target,
    f = new FormData(form),
    submit = form.querySelector("button:not([type]),button[type=submit]"),
    previous = pending;
  const dialogMarkup = modalVersion;
  if (submit) submit.disabled = true;
  try {
    if (form.getAttribute("id") === "sign") {
      const r = await api("admin/login", Object.fromEntries(f));
      token = r.token;
      sessionStorage.setItem("lianna.admin", token);
      $("#login-error").textContent = "";
      await load();
    } else if (form.getAttribute("id") === "filter-form") {
      filtersState[route().page] = { ...Object.fromEntries(f), page: 1 };
      await render();
    } else if (form.getAttribute("id") === "modal-form") {
      if (previous) {
        await previous(f);
        if (modalVersion === dialogMarkup) {
          $("#dialog").close();
          pending = null;
        }
        toast("操作完成");
      }
    } else if (form.getAttribute("id") === "media-form") {
      const m = move(form.dataset.id),
        media = { ...(m.draft?.media || m.media || {}) };
      for (const kind of ["cover", "animation"]) {
        const file = f.get(kind);
        if (file?.size) {
          if (file.size > 4 * 1024 * 1024) throw Error("每张素材不得超过4MB");
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          const r = await call("media-upload", { data });
          media[kind] = location.origin + r.url;
          media[kind + "Hash"] = r.hash;
        }
      }
      await call("move-draft", {
        id: m.id,
        base: m.version,
        value: { ...(m.draft || m), media },
      });
      await refresh();
      toast("素材已存为草稿，审核发布后生效");
    } else if (
      form.getAttribute("id") === "move-form" ||
      form.getAttribute("id") === "schedule-form"
    ) {
      const m = move(form.dataset.id),
        value = { ...(m.draft || m) };
      if (form.getAttribute("id") === "move-form") {
        for (const k of ["name", "part", "muscle"]) value[k] = f.get(k);
        value.steps = f
          .get("steps")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        value.gear = f
          .get("gear")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        value.aliases = f.get("aliases").split(",").filter(Boolean);
      } else {
        for (const k of ["pattern", "level", "unit"]) value[k] = f.get(k);
        for (const k of ["target", "rest", "seconds"])
          value[k] = Number(f.get(k));
        value.enabled = f.has("enabled");
        value.approved = f.has("approved");
        value.replacements = String(f.get("replacements") || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
      }
      await call("move-draft", { id: m.id, base: m.version, value });
      await refresh();
      toast("草稿已保存");
    } else if (form.getAttribute("id") === "module-form") {
      const module = form.dataset.module;
      let value;
      if (module === "ai") {
        value = {};
        for (const [k, v] of f)
          value[k] = ["model", "prompt"].includes(k)
            ? v
            : v === ""
              ? null
              : Number(v);
      } else if (module === "templates") {
        value = structuredClone(config[module].active);
        value.enabled = f.has("enabled");
        value.dates = value.dates.map((x, i) =>
          String(f.get("dates" + i))
            .split(",")
            .map((v) => Number(v.trim()) - 1),
        );
        for (const key of Object.keys(value.patterns))
          value.patterns[key] = String(f.get("pattern-" + key))
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        for (const key of Object.keys(value.sets))
          value.sets[key] = Number(f.get("sets-" + key));
      } else value = JSON.parse(f.get("value"));
      await api("admin/draft", { module, base: config[module].version, value });
      config[module] = null;
      $("#app").innerHTML = await modulePage(
        module,
        names[route().page] || module,
      );
      toast("配置草稿已保存");
    } else if (form.getAttribute("id") === "role-form") {
      const name = form.dataset.name,
        before = D.roleDefs.find((r) => r.name === name).permissions,
        after = f.getAll("permission");
      confirm(
        "确认权限变更",
        kv([
          ["角色", esc(name)],
          [
            "新增",
            esc(
              after
                .filter((p) => !before.includes(p))
                .map((p) => permissionLabels[p])
                .join("、") || "无",
            ),
          ],
          [
            "收回",
            esc(
              before
                .filter((p) => !after.includes(p))
                .map((p) => permissionLabels[p])
                .join("、") || "无",
            ),
          ],
        ]) + note("该角色所有管理员的登录会话将立即失效。", true),
        async (reason) => {
          await call("role-save", { name, permissions: after, reason });
          await refresh();
        },
      );
    }
  } catch (error) {
    if (form.getAttribute("id") === "sign")
      $("#login-error").textContent = error.message;
    else toast(error.message);
  } finally {
    if (submit) submit.disabled = false;
  }
});
window.addEventListener("hashchange", () => {
  if ($("#dialog").open) $("#dialog").close();
  render();
});
$("#sign-submit").disabled = false;
if (token)
  load().catch((e) => {
    toast(e.message);
    $("#login").hidden = false;
  });
