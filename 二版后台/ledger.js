"use strict";
const M = require("./management"),
  R = require("./rules"),
  { need } = R;
// Money is stored as integer trillionths of CNY. No floating point accumulation.
const SCALE = 1000000000000n;
function units(v) {
  need(typeof v === "number" || typeof v === "string", "金额无效");
  const str = String(v);
  need(/^\d+(\.\d{1,12})?$/.test(str), "金额须为非负数，最多12位小数");
  const [a, b = ""] = str.split(".");
  return BigInt(a) * SCALE + BigInt(b.padEnd(12, "0"));
}
const amount = (v) => {
  if (v == null) return null;
  const n = BigInt(v),
    a = n < 0n ? -n : n;
  return (
    (n < 0n ? "-" : "") + a / SCALE + "." + String(a % SCALE).padStart(12, "0")
  );
};
function converted(b) {
  need(
    typeof b.currency === "string" && /^[A-Z]{3}$/.test(b.currency),
    "请填写三位币种代码",
  );
  const rate = b.currency === "CNY" ? "1" : String(b.rate || "");
  need(units(rate) > 0n, "换算汇率必须大于零");
  if (b.currency !== "CNY") {
    need(b.rateDate && b.rateSource?.trim(), "外币账单必须提供汇率日期和来源");
    R.day(b.rateDate);
  }
  return { rate, value: ((units(b.amount) * units(rate)) / SCALE).toString() };
}
function estimate(usage, price) {
  if (
    !Number.isSafeInteger(usage?.prompt_tokens) ||
    !Number.isSafeInteger(usage?.completion_tokens) ||
    usage.prompt_tokens < 0 ||
    usage.completion_tokens < 0
  )
    return null;
  const cache = usage.prompt_cache_hit_tokens ?? 0;
  need(
    Number.isSafeInteger(cache) && cache >= 0 && cache <= usage.prompt_tokens,
    "缓存计费数据无效",
  );
  return (
    (BigInt(usage.prompt_tokens - cache) * units(price.pricePerMillionInput) +
      BigInt(cache) *
        units(price.pricePerMillionCache ?? price.pricePerMillionInput) +
      BigInt(usage.completion_tokens) * units(price.pricePerMillionOutput)) /
    1000000n
  ).toString();
}
function setup(s) {
  s.db.exec(`
CREATE TABLE IF NOT EXISTS generations(id TEXT PRIMARY KEY,owner TEXT,request TEXT,at TEXT,ended TEXT,scene TEXT,environment TEXT,status TEXT,input TEXT,output TEXT,config TEXT,parent TEXT,adoption TEXT DEFAULT '未采用',object TEXT,error TEXT,UNIQUE(owner,request));
CREATE TABLE IF NOT EXISTS model_calls(id TEXT PRIMARY KEY,generation TEXT,owner TEXT,at TEXT,ended TEXT,seq INTEGER,model TEXT,provider_id TEXT,result TEXT,usage TEXT,price TEXT,estimate TEXT,confirmed TEXT,billing TEXT,reserve TEXT,error TEXT);
CREATE TABLE IF NOT EXISTS bills(id TEXT PRIMARY KEY,call_id TEXT,period TEXT,currency TEXT,original TEXT,rate TEXT,amount TEXT,source TEXT,at TEXT,actor TEXT);
CREATE TABLE IF NOT EXISTS ledger_meta(key TEXT PRIMARY KEY,value TEXT);`);
  s.db
    .exec(`CREATE TABLE IF NOT EXISTS bill_meta(id TEXT PRIMARY KEY,rate_date TEXT,rate_source TEXT);
CREATE TABLE IF NOT EXISTS bill_adjustments(id TEXT PRIMARY KEY,bill TEXT,kind TEXT,currency TEXT,original TEXT,rate TEXT,amount TEXT,rate_date TEXT,rate_source TEXT,source TEXT,reason TEXT,at TEXT,actor TEXT);
CREATE TABLE IF NOT EXISTS model_payloads(call_id TEXT PRIMARY KEY,request TEXT,response TEXT,validation TEXT);
CREATE TABLE IF NOT EXISTS funding(id TEXT PRIMARY KEY,kind TEXT,currency TEXT,original TEXT,rate TEXT,amount TEXT,source TEXT,at TEXT,actor TEXT);`);
  if (!s.get("SELECT 1 FROM ledger_meta WHERE key='legacy'"))
    s.tx(() => {
      // Existing audit entries lack request and price snapshots. Preserve that uncertainty.
      for (const e of s.all("SELECT * FROM audit WHERE kind='AI 调用'")) {
        const v = M.parse(e.info),
          g = "Glegacy-" + e.id,
          c = "Clegacy-" + e.id,
          known =
            !!v.ok &&
            Number.isFinite(v.cost) &&
            (v.inputTokens > 0 || v.outputTokens > 0);
        s.run(
          "INSERT OR IGNORE INTO generations(id,owner,request,at,ended,scene,environment,status,input,output,config,adoption,error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          g,
          e.actor,
          "legacy-" + e.id,
          e.at + "+08:00",
          e.at + "+08:00",
          e.actor?.startsWith("op:") ? "后台测试" : "饮食推荐",
          e.actor?.startsWith("op:") ? "test" : "production",
          v.ok ? "成功交付" : "规则回退",
          "null",
          "null",
          JSON.stringify({ model: v.model, version: v.version, legacy: true }),
          "未知",
          v.reason || null,
        );
        if (
          ["今日额度已用尽", "模型未配置", "模型服务地址无效"].includes(
            v.reason,
          )
        )
          continue;
        s.run(
          "INSERT OR IGNORE INTO model_calls VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          c,
          g,
          e.actor,
          e.at + "+08:00",
          e.at + "+08:00",
          1,
          v.model || "未知",
          null,
          v.ok ? "成功" : "待核对",
          JSON.stringify(
            known
              ? {
                  prompt_tokens: v.inputTokens,
                  completion_tokens: v.outputTokens,
                }
              : null,
          ),
          "null",
          known ? units(v.cost.toFixed(12)).toString() : null,
          null,
          known ? "仅估算" : "未获得用量",
          "0",
          v.reason || "旧系统未记录逐次价格和调用标识",
        );
      }
      s.run("INSERT INTO ledger_meta VALUES('legacy','1')");
    });
  s.run(
    "UPDATE generations SET status='待核对',error='服务重启，原请求结果待核对' WHERE status='处理中'",
  );
  s.run(
    "UPDATE model_calls SET result='待核对',error='服务中断，保留预留金额等待用量核对' WHERE result='进行中'",
  );
}
function dayKey(v) {
  return new Date(new Date(v).getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
}
function reserve(s, g, config, seq) {
  return s.tx(() => {
    const today = dayKey(M.now()),
      calls = s
        .all("SELECT * FROM model_calls")
        .filter((c) => dayKey(c.at) === today),
      gens = s.all("SELECT id,owner FROM generations");
    need(calls.length < config.dailyLimit, "今日额度已用尽");
    if (config.userDailyLimit != null)
      need(
        calls.filter((c) => c.owner === g.owner).length < config.userDailyLimit,
        "此账号今日额度已用尽",
      );
    const max = estimate(
      {
        prompt_tokens: config.maxInputTokens || 8192,
        completion_tokens: config.maxOutputTokens || 2048,
      },
      config,
    );
    const spent = calls.reduce(
      (sum, c) => sum + BigInt(c.confirmed ?? c.estimate ?? c.reserve ?? "0"),
      0n,
    );
    if (config.dailyBudget != null)
      need(
        spent + BigInt(max) <= units(config.dailyBudget),
        "今日预算不足，已保留手动搭配",
      );
    const id = M.id("C"),
      at = M.now();
    s.run(
      "INSERT INTO model_calls VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id,
      g.id,
      g.owner,
      at,
      null,
      seq,
      config.model,
      null,
      "进行中",
      "null",
      JSON.stringify({ ...config, currency: "CNY", unit: 1000000 }),
      null,
      null,
      "未获得用量",
      max,
      null,
    );
    return id;
  });
}
async function recommend(s, actor, profile, b, c, config, external, key, url) {
  const request =
    typeof b.requestId === "string" ? b.requestId : M.id("request-");
  need(request.length <= 120, "请求编号过长");
  const existing = s.get(
    "SELECT * FROM generations WHERE owner=? AND request=?",
    actor,
    request,
  );
  if (existing) {
    if (existing.status === "处理中")
      return {
        generationId: existing.id,
        items: [],
        manual: true,
        reason: "该请求正在处理，请稍后查看",
      };
    return {
      ...M.parse(existing.output, {
        items: [],
        manual: true,
        reason: existing.error || "结果待核对",
      }),
      generationId: existing.id,
    };
  }
  const foods = c.foods.filter(
      (f) =>
        R.usable(f, profile, c.risk) &&
        (!b.candidateIds || b.candidateIds.includes(f.id)),
    ),
    input = {
      meal: R.parts[b.index],
      candidates: foods.map((f) => ({ id: f.id, name: f.name })),
      taste: String(b.taste || "").slice(0, 120),
    },
    gid = M.id("G"),
    at = M.now(),
    scene = actor.startsWith("op:")
      ? "后台测试"
      : b.parentId
        ? "换食材推荐"
        : "饮食初次推荐";
  const snapshot = { ...config, version: c.version.ai };
  s.run(
    "INSERT INTO generations(id,owner,request,at,scene,environment,status,input,config,parent) VALUES(?,?,?,?,?,?,?,?,?,?)",
    gid,
    actor,
    request,
    at,
    scene,
    actor.startsWith("op:") ? "test" : "production",
    "处理中",
    JSON.stringify({
      ...input,
      restrictions: {
        allergens: profile?.allergens || [],
        avoid: profile?.avoid || [],
      },
      rules: c.version,
    }),
    JSON.stringify(snapshot),
    b.parentId || null,
  );
  let output = { items: [], manual: true, reason: "模型未配置" },
    status = "规则回退",
    lastError = "";
  try {
    need(key && url && config.model, "模型未配置");
    need(config.enabled !== false, "AI 推荐已停用");
    need(/^https:\/\//.test(url), "模型服务地址无效");
    const messages = [
      { role: "system", content: config.prompt },
      { role: "user", content: JSON.stringify(input) },
    ];
    // UTF-8 byte count is a conservative input-token ceiling for the bounded JSON request.
    need(
      Buffer.byteLength(JSON.stringify(messages), "utf8") + 256 <=
        (config.maxInputTokens || 8192),
      "候选输入超过本次预算上限，请缩小候选范围",
    );
    const attempts =
      (config.maxRetries || 0) + 1 + (config.fallbackModel ? 1 : 0);
    for (let seq = 1; seq <= attempts; seq++) {
      let cid;
      try {
        const current =
          seq > (config.maxRetries || 0) + 1
            ? {
                ...config,
                model: config.fallbackModel,
                pricePerMillionInput: config.fallbackInput,
                pricePerMillionOutput: config.fallbackOutput,
                pricePerMillionCache:
                  config.fallbackCache ?? config.fallbackInput,
              }
            : config;
        cid = reserve(s, { id: gid, owner: actor }, current, seq);
        s.run(
          "INSERT INTO model_payloads VALUES(?,?,?,?)",
          cid,
          JSON.stringify({
            model: current.model,
            messages,
            max_tokens: current.maxOutputTokens || 2048,
          }),
          "null",
          "等待响应",
        );
        const reply = await external(url, {
          method: "POST",
          signal: AbortSignal.timeout(config.timeoutMs || 12000),
          headers: {
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: current.model,
            thinking: { type: "disabled" },
            max_tokens: config.maxOutputTokens || 2048,
            messages,
          }),
        });
        const data = await reply.json();
        const value = estimate(data.usage, current);
        // Store deliverable content only; never persist provider reasoning or credentials.
        s.run(
          "UPDATE model_payloads SET response=? WHERE call_id=?",
          JSON.stringify({
            content: String(data.choices?.[0]?.message?.content || "").slice(
              0,
              60000,
            ),
            error: data.error
              ? { code: data.error.code, type: data.error.type }
              : null,
          }),
          cid,
        );
        s.run(
          "UPDATE model_calls SET provider_id=?,usage=?,estimate=?,billing=?,reserve=? WHERE id=?",
          data.id || reply.headers?.get?.("x-request-id") || null,
          JSON.stringify(data.usage || null),
          value,
          value == null ? "未获得用量" : "仅估算",
          value == null
            ? s.get("SELECT reserve FROM model_calls WHERE id=?", cid).reserve
            : "0",
          cid,
        );
        need(reply.ok, "模型服务返回错误 " + (reply.status || ""));
        const raw = data.choices?.[0]?.message?.content;
        need(typeof raw === "string" && raw.trim(), "模型返回内容为空");
        const choices = JSON.parse(
            raw
              .trim()
              .replace(/^```(?:json)?\s*/i, "")
              .replace(/\s*```$/, ""),
          ),
          live = s.content(),
          liveProfile = actor.startsWith("op:")
            ? profile
            : s.account(actor).profile;
        need(
          Array.isArray(choices) &&
            choices.length &&
            choices.every(
              (x) =>
                foods.some((f) => f.id === x.id) &&
                live.foods.some(
                  (f) => f.id === x.id && R.usable(f, liveProfile, live.risk),
                ),
            ),
          "模型返回不可用编号",
        );
        output = {
          items: choices.map((x) => ({
            id: x.id,
            reason: String(x.reason || "").slice(0, 200),
          })),
          generationId: gid,
        };
        status = "成功交付";
        s.run(
          "UPDATE model_payloads SET validation=? WHERE call_id=?",
          "候选编号与最新限制校验通过",
          cid,
        );
        s.run(
          "UPDATE model_calls SET ended=?,result='成功' WHERE id=?",
          M.now(),
          cid,
        );
        break;
      } catch (e) {
        lastError = e.status
          ? e.message
          : e.name === "TimeoutError"
            ? "模型超时，费用待回补"
            : "模型返回格式异常或连接失败";
        if (cid)
          s.run(
            "UPDATE model_payloads SET validation=? WHERE call_id=?",
            lastError,
            cid,
          );
        if (cid)
          s.run(
            "UPDATE model_calls SET ended=?,result=?,error=? WHERE id=?",
            M.now(),
            e.name === "TimeoutError" ? "超时" : "失败",
            lastError,
            cid,
          );
        output = {
          items: [],
          manual: true,
          reason: lastError,
          generationId: gid,
        };
        if (!cid || seq === attempts) break;
      }
    }
  } catch (e) {
    lastError = e.status ? e.message : "模型调用未完成";
    output = { items: [], manual: true, reason: lastError, generationId: gid };
  }
  s.run(
    "UPDATE generations SET ended=?,status=?,output=?,error=? WHERE id=?",
    M.now(),
    status,
    JSON.stringify(output),
    status === "成功交付" ? null : lastError,
    gid,
  );
  const cs = s.all("SELECT * FROM model_calls WHERE generation=?", gid),
    total = cs.reduce((sum, x) => sum + BigInt(x.estimate || 0), 0n);
  s.audit(actor, "AI 调用", {
    generationId: gid,
    model: config.model,
    version: c.version.ai,
    ok: status === "成功交付",
    cost: Number(total) / 1e12,
    inputTokens: cs.reduce(
      (n, x) => n + (M.parse(x.usage)?.prompt_tokens || 0),
      0,
    ),
    outputTokens: cs.reduce(
      (n, x) => n + (M.parse(x.usage)?.completion_tokens || 0),
      0,
    ),
    reason: lastError,
    duration: Date.now() - new Date(at).getTime(),
  });
  return output;
}
function permittedRows(s, p, b = {}) {
  const generations = s
    .all("SELECT * FROM generations ORDER BY at DESC")
    .filter((g) => M.inScope(s, p, g.owner, g.scene, g.environment))
    .filter(
      (g) =>
        (!b.environment || g.environment === b.environment) &&
        (!b.user || M.user(s, g.owner).id === b.user) &&
        (!b.scene || g.scene === b.scene),
    );
  const ids = new Set(generations.map((g) => g.id)),
    calls = s
      .all("SELECT * FROM model_calls ORDER BY at DESC")
      .filter((c) => ids.has(c.generation));
  return { generations, calls };
}
function globalScope(p) {
  return (
    p.super ||
    (p.scope.users === "all" &&
      p.scope.environment === "all" &&
      !p.scope.scenes?.length)
  );
}
function endpoint(s, actor, action, b, req) {
  const p = M.principal(s, actor);
  M.allow(p, "ai.view");
  if (action === "adjustment") {
    M.allow(p, "ai.cost");
    need(
      b.reason?.trim() && b.source?.trim() && b.adjustmentId,
      "请填写调整编号、依据和原因",
    );
    const bill = s.get("SELECT * FROM bills WHERE id=?", b.billId);
    need(bill, "原账单不存在", 404);
    const c =
        bill.call_id &&
        s.get("SELECT * FROM model_calls WHERE id=?", bill.call_id),
      g = c && s.get("SELECT * FROM generations WHERE id=?", c.generation);
    need(
      g ? M.inScope(s, p, g.owner, g.scene, g.environment) : globalScope(p),
      "无此账单权限",
      403,
    );
    need(["退款", "调减", "调增"].includes(b.kind), "请选择调整类型");
    const fx = converted(b),
      signed = (b.kind === "调增" ? 1n : -1n) * BigInt(fx.value),
      old = s.get("SELECT * FROM bill_adjustments WHERE id=?", b.adjustmentId);
    if (old) {
      need(
        old.bill === bill.id &&
          old.amount === String(signed) &&
          old.currency === b.currency &&
          old.original === String(b.amount),
        "调整编号已用于其他内容",
        409,
      );
      return { duplicate: true };
    }
    const previous = s
        .all("SELECT amount FROM bill_adjustments WHERE bill=?", bill.id)
        .reduce((n, x) => n + BigInt(x.amount), 0n),
      net = BigInt(bill.amount) + previous + signed;
    need(net >= 0n, "累计退款或调减不能超过账单确认金额");
    s.run(
      "INSERT INTO bill_adjustments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      b.adjustmentId,
      bill.id,
      b.kind,
      b.currency,
      String(b.amount),
      fx.rate,
      String(signed),
      b.rateDate || M.now().slice(0, 10),
      b.rateSource || "人民币无需换算",
      b.source,
      b.reason,
      M.now(),
      actor,
    );
    if (c)
      s.run(
        "UPDATE model_calls SET confirmed=?,billing='账单确认' WHERE id=?",
        String(net),
        c.id,
      );
    M.audit(
      s,
      actor,
      "账单" + b.kind,
      bill.id,
      "成功",
      b.reason,
      { confirmed: amount(BigInt(bill.amount) + previous) },
      { confirmed: amount(net), adjustmentId: b.adjustmentId },
      req,
    );
    return { net: amount(net) };
  }
  if (action === "funding") {
    M.allow(p, "ai.cost");
    need(globalScope(p), "资金登记需要完整数据范围", 403);
    need(
      ["充值", "余额快照", "购买额度"].includes(b.kind) &&
        b.entryId &&
        b.source &&
        b.reason,
      "请填写资金类型、编号、来源和原因",
    );
    const fx = converted(b),
      old = s.get("SELECT * FROM funding WHERE id=?", b.entryId);
    if (old) {
      need(old.kind === b.kind && old.amount === fx.value, "编号已使用", 409);
      return { duplicate: true };
    }
    s.run(
      "INSERT INTO funding VALUES(?,?,?,?,?,?,?,?,?)",
      b.entryId,
      b.kind,
      b.currency,
      String(b.amount),
      fx.rate,
      fx.value,
      b.source,
      M.now(),
      actor,
    );
    M.audit(
      s,
      actor,
      "资金资料登记",
      b.entryId,
      "成功",
      b.reason,
      null,
      { kind: b.kind, amount: amount(fx.value) },
      req,
    );
    return {};
  }
  if (action === "bill" || action === "usage" || action === "period-bill") {
    M.allow(p, "ai.cost");
    need(b.reason?.trim(), "请填写核对原因");
    if (action === "period-bill") {
      need(globalScope(p), "周期账单包含全局费用，需要完整数据范围", 403);
      need(
        b.billId && b.source && b.period,
        "请提供周期、原币金额、账单行编号与来源",
      );
      const fx = converted(b),
        a = fx.value,
        old = s.get("SELECT * FROM bills WHERE id=?", b.billId);
      if (old) {
        need(
          old.call_id === null &&
            old.amount === a &&
            old.currency === b.currency &&
            old.original === String(b.amount),
          "账单行已用于其他核对",
          409,
        );
        return { duplicate: true };
      }
      s.run(
        "INSERT INTO bills VALUES(?,?,?,?,?,?,?,?,?,?)",
        b.billId,
        null,
        b.period,
        b.currency,
        String(b.amount),
        fx.rate,
        a,
        b.source,
        M.now(),
        actor,
      );
      s.run(
        "INSERT INTO bill_meta VALUES(?,?,?)",
        b.billId,
        b.rateDate || M.now().slice(0, 10),
        b.rateSource || "人民币无需换算",
      );
      M.audit(
        s,
        actor,
        action,
        b.billId,
        "成功",
        b.reason,
        null,
        { period: b.period, amount: b.amount },
        req,
      );
      return {};
    }
    const c = s.get("SELECT * FROM model_calls WHERE id=?", b.id),
      g = c && s.get("SELECT * FROM generations WHERE id=?", c.generation);
    need(
      g && M.inScope(s, p, g.owner, g.scene, g.environment),
      "无此调用权限",
      403,
    );
    if (action === "usage") {
      const value = estimate(b.usage, M.parse(c.price));
      need(value !== null, "请提供可核实的输入与输出用量");
      s.run(
        "UPDATE model_calls SET usage=?,estimate=?,reserve=?,billing=? WHERE id=?",
        JSON.stringify(b.usage),
        value,
        "0",
        c.confirmed ? "账单确认" : "仅估算",
        c.id,
      );
      M.audit(
        s,
        actor,
        action,
        c.id,
        "成功",
        b.reason,
        null,
        { usage: b.usage, estimate: amount(value) },
        req,
      );
      return {};
    }
    need(
      b.billId && b.source && b.period,
      "请提供可归属此调用的账单行编号、来源、周期和原币金额",
    );
    const fx = converted(b),
      a = fx.value,
      old = s.get("SELECT * FROM bills WHERE id=?", b.billId);
    if (old) {
      need(
        old.call_id === c.id &&
          old.amount === a &&
          old.currency === b.currency &&
          old.original === String(b.amount),
        "该账单行已关联其他消费或金额不一致",
        409,
      );
      return { duplicate: true };
    }
    need(c.confirmed === null, "此调用已有确认账单，请使用原账单核对", 409);
    s.run(
      "INSERT INTO bills VALUES(?,?,?,?,?,?,?,?,?,?)",
      b.billId,
      c.id,
      b.period,
      b.currency,
      String(b.amount),
      fx.rate,
      a,
      b.source,
      M.now(),
      actor,
    );
    s.run(
      "INSERT INTO bill_meta VALUES(?,?,?)",
      b.billId,
      b.rateDate || M.now().slice(0, 10),
      b.rateSource || "人民币无需换算",
    );
    s.run(
      "UPDATE model_calls SET confirmed=?,billing='账单确认',reserve='0' WHERE id=?",
      a,
      c.id,
    );
    M.audit(
      s,
      actor,
      "账单确认",
      c.id,
      "成功",
      b.reason,
      { estimate: amount(c.estimate) },
      { confirmed: b.amount, billId: b.billId },
      req,
    );
    return {};
  }
  const rows = permittedRows(s, p, b);
  if (action === "export" && Array.isArray(b.ids))
    rows.calls = rows.calls.filter((c) => b.ids.includes(c.id));
  if (action === "detail") {
    const g = rows.generations.find((g) => g.id === b.id);
    need(g, "记录不存在或无权查看", 404);
    M.allow(p, "ai.sensitive");
    need(b.reason?.trim(), "请填写访问原因");
    M.audit(
      s,
      actor,
      "读取AI输入输出",
      g.id,
      "成功",
      b.reason,
      null,
      { fields: ["input", "output"] },
      req,
    );
    return {
      input: M.parse(g.input),
      output: M.parse(g.output),
      payloads: s
        .all(
          "SELECT p.* FROM model_payloads p JOIN model_calls c ON c.id=p.call_id WHERE c.generation=?",
          g.id,
        )
        .map((x) => ({
          ...x,
          request: M.parse(x.request),
          response: M.parse(x.response),
        })),
    };
  }
  need(action === "data" || action === "export", "接口不存在", 404);
  if (action === "export") {
    M.allow(p, "ai.export");
    need(b.reason?.trim(), "请填写导出原因");
    M.audit(
      s,
      actor,
      "导出AI记录",
      "calls",
      "成功",
      b.reason,
      null,
      { count: rows.calls.length },
      req,
    );
  }
  if (action === "data")
    M.audit(
      s,
      actor,
      "查询AI记录",
      "calls",
      "成功",
      "",
      null,
      { count: rows.calls.length, scope: p.scope },
      req,
    );
  const canCost = p.has("ai.cost"),
    callIds = new Set(rows.calls.map((c) => c.id)),
    showPeriod = globalScope(p) && !b.environment && !b.user && !b.scene;
  const visibleBills = canCost
      ? s
          .all(
            "SELECT b.*,m.rate_date,m.rate_source FROM bills b LEFT JOIN bill_meta m ON m.id=b.id",
          )
          .filter((x) => (x.call_id ? callIds.has(x.call_id) : showPeriod))
      : [],
    billIds = new Set(visibleBills.map((x) => x.id));
  return {
    adjustments: canCost
      ? s
          .all("SELECT * FROM bill_adjustments")
          .filter((x) => billIds.has(x.bill))
          .map((x) => ({ ...x, amount: amount(x.amount) }))
      : [],
    funding:
      canCost && showPeriod
        ? s
            .all("SELECT * FROM funding ORDER BY at DESC")
            .map((x) => ({ ...x, amount: amount(x.amount) }))
        : [],
    generations: rows.generations.map((g) => ({
      ...g,
      user: g.owner?.startsWith("op:") ? g.owner : M.user(s, g.owner).id,
      owner: undefined,
      input: undefined,
      output: undefined,
      config: canCost
        ? M.parse(g.config)
        : {
            model: M.parse(g.config).model,
            version: M.parse(g.config).version,
          },
    })),
    calls: rows.calls.map((c) => ({
      ...c,
      owner: undefined,
      usage: M.parse(c.usage),
      price: canCost ? M.parse(c.price) : undefined,
      estimate: canCost ? amount(c.estimate) : undefined,
      confirmed: canCost ? amount(c.confirmed) : undefined,
      reserve: canCost ? amount(c.reserve) : undefined,
    })),
    bills: visibleBills.map((b) => ({ ...b, amount: amount(b.amount) })),
  };
}
module.exports = {
  setup,
  recommend,
  endpoint,
  estimate,
  units,
  amount,
  reserve,
  dayKey,
  globalScope,
};
