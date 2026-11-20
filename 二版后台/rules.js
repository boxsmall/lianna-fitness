'use strict';
const { exercises, gearList } = require('../微信小程序/miniprogram/data/catalog');
const { randomUUID } = require('node:crypto');
const moves = new Map(
  exercises.flatMap((m) => [
    [m.id, m],
    [m.sourceId, m]
  ])
);
const goals = ['增肌', '减脂', '日常健身'];
const metrics = ['kcal', 'carb', 'protein', 'fat'];
const parts = ['早餐', '午餐', '晚餐', '加餐'];
function need(ok, message, status = 400) {
  if (!ok) throw Object.assign(new Error(message), { status });
}
function integer(n, min, max, label) {
  need(Number.isInteger(n) && n >= min && n <= max, label);
  return n;
}
function positive(n, label) {
  need(Number.isFinite(n) && n > 0, label);
  return n;
}
function day(s) {
  need(typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s), '日期格式无效');
  const d = new Date(s + 'T00:00:00Z');
  need(Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s, '日期无效');
  return d;
}
function shift(s, n) {
  const d = day(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function monday(s) {
  return shift(s, -((day(s).getUTCDay() + 6) % 7));
}
function missing(m, gear) {
  return m.gear.filter(
    (g) => !gear.includes(g) && !(m.alternatives?.[g] || []).some((a) => gear.includes(a))
  );
}
function unique(a) {
  return [...new Set(a)];
}
function item(id, meta = {}, sets = 2) {
  const m = moves.get(id);
  need(m, '动作不存在');
  return {
    key: randomUUID(),
    id: m.sourceId,
    name: meta.name || m.name,
    steps: meta.steps || m.steps,
    media: meta.media || {cover: "/media/cover/"+m.sourceId,animation:"/media/new/"+m.sourceId},
    pattern: meta.pattern || '',
    unit: meta.unit || '次',
    sets,
    target: meta.target || 10,
    rest: meta.rest ?? 45,
    seconds: meta.seconds || 3
  };
}
function timing(items) {
  let warm = 0,
    work = 0,
    rest = 0;
  for (const m of items) {
    const t = m.sets * m.target * (m.unit === '秒' ? 1 : m.seconds);
    if (m.pattern === '热身') warm += t;
    else work += t;
    rest += (m.sets - 1) * m.rest;
  }
  const transition = Math.max(0, items.length - 1) * 30;
  return { warm, work, rest, transition, total: warm + work + rest + transition };
}
function plan(input, content, prefs, existing = {}) {
  const { goal, days, minutes, start } = input;
  need(goals.includes(goal), '请选择训练目标');
  integer(days, 1, 7, '每周天数应为 1～7');
  integer(minutes, 1, 180, '时长应为 1～180 分钟');
  need(monday(start) === start, '计划须从周一开始');
  const gear = input.gear || [];
  need(Array.isArray(gear) && gear.every((g) => gearList.includes(g)), '器械无效');
  const template = content.templates;
  const manual = days > 4 || input.blank === true;
  const base = manual ? (days > 4 && input.useFour ? 4 : 0) : days;
  need(!base || template.enabled !== false, '自动排课模板尚未发布，可从空白周自行编排');
  const weekdays = input.weekdays?.length ? input.weekdays : template.dates[days - 1];
  need(
    Array.isArray(weekdays) &&
      unique(weekdays).length === days &&
      weekdays.length === days &&
      weekdays.every((n) => Number.isInteger(n) && n >= 0 && n < 7),
    '训练日数量与所选天数不一致'
  );
  const ordered = [...weekdays].sort((a, b) => a - b);
  const dateList = Array.from({ length: 7 }, (_, i) => shift(start, i));
  const parity = ((Math.floor((day(start) - day(input.anchor || start)) / 604800000) % 2) + 2) % 2;
  const rejected = [];
  const sessions = {};
  for (const [i, weekday] of ordered.entries()) {
    const date = dateList[weekday];
    let type =
      base === 4
        ? i % 2
          ? '下肢'
          : '上肢'
        : (i + (base === 3 ? parity : 0)) % 2
          ? '全身 B'
          : '全身 A';
    if (base === 1) type = '全身';
    const auto = i < base;
    let items = [];
    if (auto) {
      const patterns = template.patterns[type].slice();
      if (goal === '减脂' && minutes >= 25) patterns.push('有氧');
      const isUpper = type === '上肢',
        isLower = type === '下肢';
      const candidate = (pattern) => {
        const suitable = content.actions.filter(
          (a) =>
            a.pattern === pattern &&
            a.enabled &&
            a.approved &&
            a.visible !== false &&
            (input.experience === '有经验' || a.level === '基础')
        );
        const source = (a) => ({
          ...moves.get(a.id),
          gear: a.gear || moves.get(a.id).gear,
          alternatives: a.alternatives || moves.get(a.id).alternatives
        });
        for (const a of suitable) {
          const lack = missing(source(a), gear);
          if (lack.length) rejected.push({ id: a.id, reason: '缺少' + lack.join('、') });
        }
        const rank = (a) => {
          const m = source(a);
          const relevant =
            pattern === '热身' &&
            (isUpper
              ? ['胸部', '肩部', '背部', '手臂'].includes(m.part)
              : isLower
                ? m.part === '臀腿'
                : m.warmPart === '全身');
          return (relevant ? 4 : 0) + (prefs.favorites.includes(m.id) ? 2 : 0);
        };
        return suitable
          .filter((a) => !missing(source(a), gear).length)
          .sort((a, b) => rank(b) - rank(a));
      };
      for (const pattern of ['热身', ...patterns]) {
        const list = candidate(pattern);
        if (!list.length) {
          if (pattern === '有氧' || pattern === '辅助') continue;
          need(false, '缺少可用' + pattern + '动作。请调整器械或自行编排。');
        }
        const a = list[0];
        items.push(item(a.id, a, pattern === '热身' ? 1 : template.sets[goal]));
      }
      while (
        timing(items).total > minutes * 60 &&
        items.some((m) => ['辅助', '有氧'].includes(m.pattern))
      )
        items.splice(
          items.findLastIndex((m) => ['辅助', '有氧'].includes(m.pattern)),
          1
        );
      while (timing(items).total > minutes * 60 && items.some((m) => m.sets > 1)) {
        const a = items.reduce((x, y) => (x.sets >= y.sets ? x : y));
        a.sets--;
      }
      const over = Math.ceil((timing(items).total - minutes * 60) / 60);
      need(over <= 0, '最低组数仍超出 ' + over + ' 分钟，请延长时长或自行编排。');
    } else type = '自行编排';
    sessions[date] = {
      key: randomUUID(),
      date,
      type,
      items,
      budget: minutes,
      status: '待训练',
      manual: !auto,
      timing: timing(items)
    };
  }
  const preserved = [],
    replaced = [];
  for (const date of dateList) {
    const old = existing[date];
    if (!old) continue;
    if (old.status !== '待训练' || old.carried) {
      sessions[date] = old;
      preserved.push(date);
    } else replaced.push({ date, manual: old.manual });
  }
  return {
    start,
    goal,
    gear,
    days,
    minutes,
    dates: dateList,
    sessions,
    preserved,
    replaced,
    rejected,
    version: { actions: content.version.actions, templates: content.version.templates },
    anchor: input.anchor || start
  };
}
function mealTarget(profile, index) {
  integer(index, 0, profile.ratios.length - 1, '餐次无效');
  const result = {};
  for (const k of metrics) {
    const total = profile.targets[k];
    const values = require('../微信小程序/miniprogram/lib/nutrition').allocate(total, profile.ratios);
    result[k] = values[index];
  }
  return result;
}
function foodReason(f, profile, risk = {}) {
  if (
    !f.enabled ||
    !f.source ||
    !f.state ||
    !metrics.every((k) => Number.isFinite(f[k]) && f[k] >= 0)
  )
    return '未启用或缺少来源、称重或营养数据';
  const avoid = (profile.avoid || []).find((x) => f.tags.includes(x));
  if (avoid) return '忌口：' + avoid;
  for (const x of profile.allergens || []) {
    if (f.contains.includes(x) || (risk[f.id] || []).includes(x)) return '含过敏原：' + x;
    if (!f.checked?.includes(x)) return '过敏原待核对：' + x;
  }
  return '';
}
function usable(f, profile, risk = {}) {
  return !foodReason(f, profile, risk);
}
function profile(input, rules) {
  const { sex, height, weight, ratios, allergens = [], avoid = [] } = input;
  need(['男', '女'].includes(sex), '请填写性别');
  positive(height, '请填写有效身高');
  positive(weight, '请填写有效体重');
  need(
    Array.isArray(ratios) &&
      [3, 4].includes(ratios.length) &&
      ratios.every((n) => Number.isInteger(n) && n > 0) &&
      ratios.reduce((a, b) => a + b, 0) === 100,
    '请填写三餐或三餐加加餐比例，合计须为 100%'
  );
  need(
    [allergens, avoid].every(
      (a) => Array.isArray(a) && a.every((v) => typeof v === 'string' && v.length <= 32)
    ),
    '过敏原或忌口无效'
  );
  const targets = { ...input.targets };
  let energy;
  const goalMode = input.energyModel === 'goal-v1' || !!input.goal;
  if (input.estimate) {
    need(rules.estimation?.approved, '尚无已审核的能量估算规则，可填写已有目标');
    integer(input.age, 18, 120, '通用估算仅适用于成年人');
    // Optional self-description: an unchecked switch is not a medical exclusion.
    const e = rules.estimation;
    need(Object.hasOwn(e.activity, input.activity), '请选择日常活动水平');
    const resting = weight * e.weight + height * e.height + input.age * e.age + e.offset[sex];
    need(Number.isFinite(resting) && resting > 0, '静息能量无效，请核对身体资料或计算规则');
    const maintenance = resting * e.activity[input.activity];
    targets.kcal = Math.round(maintenance);
    if (goalMode) {
      const result = require('./energy').calculate(input, rules, resting, maintenance);
      Object.assign(targets, result.targets);
      energy = result.energy;
    } else {
      // Legacy estimated profiles must not retain stale macros after energy changes.
      for (const k of metrics.slice(1)) delete targets[k];
    }
  }
  positive(targets.kcal, '请填写每日总千卡');
  const macroKeys = metrics.slice(1);
  if (macroKeys.every((k) => targets[k] == null)) {
    need(rules.macroRatio, '尚无已审核的营养比例');
    macroKeys.forEach(
      (k, i) => (targets[k] = Math.round((targets.kcal * rules.macroRatio[i]) / [4, 4, 9][i] / 100))
    );
  }
  macroKeys.forEach((k) => positive(targets[k], '请完整填写三类营养目标'));
  if (goalMode) require('./energy').checkTargets(targets);
  if (input.goal) need(require('./energy').goals.includes(input.goal), '阶段目标无效');
  if (input.targetWeight != null) {
    need(Number.isFinite(input.targetWeight) && input.targetWeight >= 25 && input.targetWeight <= 350, '目标体重须为25至350千克');
    if (input.estimate) need(input.targetWeight / (height/100)**2 >= 18.5, '目标体重过低，请使用专业目标');
  }
  return {
    sex,
    height,
    weight,
    allergens: unique(allergens),
    avoid: unique(avoid),
    targets,
    ratios,
    estimate: !!input.estimate,
    age: input.age,
    activity: input.activity,
    ...(goalMode ? { goal: input.goal, targetWeight: input.targetWeight ?? null, energyModel: 'goal-v1', resistance: input.resistance === true,
      generalAdult: input.generalAdult === true, macroMode: input.estimate ? 'auto' : (macroKeys.every(k=>input.targets?.[k]==null) ? 'auto' : 'manual'), energy: energy || null } : {})
  };
}
function meal(profile, index, selected, foods, risk = {}) {
  const target = mealTarget(profile, index),
    actual = { kcal: 0, carb: 0, protein: 0, fat: 0 },
    rows = [];
  need(
    Array.isArray(selected) &&
      selected.length <= 40 &&
      unique(selected.map((x) => x.id)).length === selected.length,
    '食材重复或过多'
  );
  const add = (f, g) => metrics.forEach((k) => (actual[k] += (f[k] * g) / 100));
  for (const x of selected) {
    const f = foods.find((f) => f.id === x.id);
    need(f && usable(f, profile, risk), '该食材暂不可用，请重新选材');
    const locked = x.locked != null;
    if (locked) {
      need(Number.isFinite(x.locked) && x.locked >= 0 && x.locked <= 10000, '锁定克数无效');
      add(f, x.locked);
    }
    rows.push({ ...f, locked: locked ? x.locked : null, grams: locked ? x.locked : 0 });
  }
  const unlocked = rows
    .filter((f) => f.locked === null)
    .sort(
      (a, b) =>
        ['carb', 'protein', 'fat'].indexOf(a.primary) -
        ['carb', 'protein', 'fat'].indexOf(b.primary)
    );
  for (const [i, f] of unlocked.entries()) {
    const k = f.primary,
      step = f.oil ? 1 : 5;
    need(f[k] > 0, '食材缺少主要营养数据');
    const peers = unlocked.slice(i).filter((other) => other.primary === k).length;
    const grams =
      Math.round((Math.max(0, target[k] - actual[k]) * 100) / f[k] / peers / step) * step;
    f.grams = grams;
    add(f, grams);
  }
  const delta = {};
  for (const k of metrics) {
    actual[k] = Math.round(actual[k]);
    delta[k] = target[k] - actual[k];
  }
  return { index, target, actual, delta, rows };
}
module.exports = {
  need,
  integer,
  day,
  shift,
  monday,
  moves,
  gearList,
  missing,
  goals,
  metrics,
  parts,
  item,
  timing,
  plan,
  profile,
  foodReason,
  usable,
  meal,
  mealTarget
};
