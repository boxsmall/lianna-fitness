'use strict';
const R = require('./rules');
const { need } = R;
const E = require('./energy'), W = require('./workout-energy');
function prepare(a, input, c) {
  const args = { ...input, anchor: Object.keys(a.weeks).sort()[0] || input.start };
  return R.plan(args, c, a.prefs, a.sessions);
}
function change(a, action, b, c, now = new Date()) {
  const today = E.date(now), time = new Date(now).getTime();
  E.effective(a, today);
  const s = a.sessions[b.date],
    workout = () => {
      need(s, '此日没有训练');
      need(s.status !== '已完成', '已完成训练仅可查看');
      return s;
    };
  if (action === 'sync') {
    const clean = (list, allowed) => {
      need(Array.isArray(list), '清单格式无效');
      return [...new Set(list.filter(allowed))];
    };
    const owned = clean(b.owned, (x) => R.gearList.includes(x)),
      fav = clean(b.favorites, (x) => R.moves.has(x)).map((x) => R.moves.get(x).id);
    const union = (x, y) => [...new Set([...x, ...y])];
    const mergeField = (key, next) => {
      const remote = a.prefs[key];
      if (b.merge) return union(remote, next);
      const baseline = b.base?.[key];
      if (!Array.isArray(baseline)) return next;
      return union(
        remote.filter((v) => !baseline.includes(v) || next.includes(v)),
        next.filter((v) => !baseline.includes(v))
      );
    };
    a.prefs = {
      owned: mergeField('owned', owned),
      favorites: mergeField('favorites', fav),
      active: []
    };
    a.prefs.active = clean(b.active, (x) => a.prefs.owned.includes(x));
  } else if (action === 'savePlan') {
    const p = prepare(a, b.input, c);
    need(
      b.version?.actions === p.version.actions && b.version?.templates === p.version.templates,
      '目录已更新，请重新预览',
      409
    );
    for (const date of p.dates) {
      if (!p.sessions[date]) delete a.sessions[date];
      else a.sessions[date] = p.sessions[date];
    }
    a.weeks[p.start] = {
      goal: p.goal,
      days: p.days,
      minutes: p.minutes,
      gear: p.gear,
      version: p.version
    };
    if (!a.stageGoal) a.stageGoal = p.goal === '日常健身' ? '维持' : p.goal;
  } else if (action === 'move') {
    workout();
    need(s.status === '待训练', '训练开始后不能调课');
    const from = R.monday(b.date),
      to = b.to;
    R.day(to);
    need(to !== b.date && to >= from && to <= R.shift(from, 13), '请选择本周或下周的日期');
    const other = a.sessions[to];
    if (other) {
      need(
        to <= R.shift(from, 6) && b.swap && other.status === '待训练',
        '目标日已有训练，请交换或重选'
      );
      other.date = b.date;
      other.manual = true;
      a.sessions[b.date] = other;
    } else delete a.sessions[b.date];
    s.date = to;
    s.manual = true;
    s.carried = to > R.shift(from, 6) || s.carried;
    a.sessions[to] = s;
  } else if (action === 'start') {
    workout();
    need(s.items.length, '请先加入动作');
    if (s.status === '待训练') {
      s.snapshot = structuredClone(s.items);
      s.actual = {};
      s.status = '训练中';
      s.startedAt = new Date(now).toISOString();
      s.timer = { seconds: 0, running: true, lastBeat: time };
      const recent = Object.values(a.measurements || {}).filter(x=>x.date<=today).sort((x,y)=>y.date.localeCompare(x.date))[0];
      s.energyPerson = a.profile ? { age: a.profile.age, weight: recent?.weight || a.profile.weight } : null;
    }
  } else if (action === 'workoutType') {
    workout();
    need(s.status === '待训练', '训练开始后不能改变估算类型');
    need(b.type === '' || Object.hasOwn(W.types, b.type), '活动类型无效');
    s.workoutType = b.type;
  } else if (['heartbeat', 'pause', 'resume'].includes(action)) {
    workout();
    need(s.status === '训练中', '请先开始训练');
    s.timer ||= { seconds: 0, running: false, lastBeat: time };
    W.tick(s, time);
    if (action === 'pause') s.timer.running = false;
    if (action === 'resume') { s.timer.running = true; s.timer.lastBeat = time; }
  } else if (action === 'record') {
    workout();
    need(s.status === '训练中', '请先开始训练');
    const i = s.items.find((m) => m.key === b.key);
    need(i, '动作不存在');
    const list = (s.actual[i.key] ||= []);
    need(list.length < i.sets, '本动作计划组已完成');
    R.integer(b.value, 1, 10000, '实际次数或秒数无效');
    if (b.weight != null) need(Number.isFinite(b.weight) && b.weight >= 0, '重量无效');
    list.push({
      id: i.id,
      unit: i.unit,
      target: i.target,
      value: b.value,
      weight: b.weight ?? null
    });
    s.actual[i.key] = list;
  } else if (action === 'finish') {
    workout();
    need(s.status === '训练中', '请先开始训练');
    s.status = '已完成';
    W.tick(s, time);
    if (s.timer) s.timer.running = false;
    s.endedAt = new Date(now).toISOString();
    s.energyEstimate = W.estimate(s);
    a.history.push(structuredClone(s));
  } else if (action === 'add' || action === 'addMany') {
    R.day(b.date);
    if (s) workout();
    const ids = action === 'add' ? [b.id] : b.ids;
    need(Array.isArray(ids) && ids.length > 0 && ids.length <= 50, '请选择 1～50 个动作');
    const week = R.monday(b.date), gear = a.weeks[week]?.gear || a.prefs.owned;
    const additions = [];
    const seen = new Set((s?.items || []).map(i => i.id));
    for (const id of ids) {
      const m = R.moves.get(id);
      need(m, '动作不存在');
      const meta = c.actions.find(x => x.id === m.sourceId);
      need(meta?.visible !== false, '此动作已下架，请选择其他动作');
      if (seen.has(m.sourceId)) continue;
      const missing = R.missing({ ...m, gear: meta?.gear || m.gear, alternatives: meta?.alternatives || m.alternatives }, gear);
      need(!missing.length || b.confirmGear, '缺少' + missing.join('、') + '，请确认仍要加入');
      additions.push(R.item(m.sourceId, meta));
      seen.add(m.sourceId);
    }
    const target = s || {
      key: require('node:crypto').randomUUID(),
      date: b.date,
      type: '自行编排',
      budget: a.weeks[week]?.minutes || 30,
      items: [],
      status: '待训练'
    };
    target.items.push(...additions);
    target.manual = true;
    target.timing = R.timing(target.items);
    a.sessions[b.date] = target;
    if (!a.weeks[week]) a.weeks[week] = {
      goal: a.stageGoal && a.stageGoal !== '维持' ? a.stageGoal : '日常健身', days: 1, minutes: target.budget, gear: [...gear],
      source: 'manual', version: { actions: c.version.actions, templates: c.version.templates }
    };
    if (a.weeks[week].source === 'manual') a.weeks[week].days = Object.keys(a.sessions).filter(d => R.monday(d) === week).length;
  } else if (['edit', 'replace', 'remove', 'reorder'].includes(action)) {
    workout();
    const original = s.items.find((x) => x.key === b.key);
    need(original, '动作已变化，请刷新');
    const targets = [s];
    if (b.future) {
      need(['edit', 'replace'].includes(action) && s.status === '待训练', '只可调整后续待训练课程');
      targets.push(
        ...Object.values(a.sessions).filter(
          (x) =>
            x.date > s.date &&
            x.type === s.type &&
            x.status === '待训练' &&
            x.items.some((i) => i.id === original.id)
        )
      );
    }
    const oldId = original.id;
    for (const target of targets) {
      const i = target === s ? original : target.items.find((x) => x.id === oldId);
      const done = target.actual?.[i.key]?.length || 0;
      if (action === 'edit') {
        R.integer(b.sets, Math.max(1, done), 100, '组数须为正整数且不能少于已完成组');
        R.integer(b.target, 1, 10000, '次数或秒数须为正整数');
        i.sets = b.sets;
        i.target = b.target;
      }
      if (action === 'replace') {
        const next = c.actions.find(
          (x) =>
            x.id === b.id &&
            x.approved &&
            x.enabled &&
            x.visible !== false &&
            (x.pattern === i.pattern ||
              c.actions.find((a) => a.id === i.id)?.replacements?.includes(x.id))
        );
        need(
          next &&
            !R.missing(
              {
                ...R.moves.get(next.id),
                gear: next.gear || R.moves.get(next.id).gear,
                alternatives: next.alternatives || R.moves.get(next.id).alternatives
              },
              a.weeks[R.monday(target.date)]?.gear || a.prefs.owned
            ).length,
          '没有可用的同模式替代动作'
        );
        need(done < i.sets, '本动作已完成');
        const replacement = R.item(next.id, next, i.sets - done);
        if (done) {
          i.sets = done;
          target.items.splice(target.items.indexOf(i) + 1, 0, replacement);
        } else target.items.splice(target.items.indexOf(i), 1, replacement);
      }
      if (action === 'remove') {
        need(!done, '已有完成组，不能移除');
        target.items.splice(target.items.indexOf(i), 1);
      }
      if (action === 'reorder') {
        R.integer(b.index, 0, target.items.length - 1, '位置无效');
        target.items.splice(target.items.indexOf(i), 1);
        target.items.splice(b.index, 0, i);
      }
      target.manual = true;
      target.timing = R.timing(target.items);
    }
  } else if (action === 'profile') {
    if (b.energyModel === 'goal-v1') need(b.version === c.version.nutrition, '营养规则已变化，请重新预览并确认', 409);
    const next = R.profile(b, c.nutrition);
    if (a.profile) (a.energyHistory ||= []).push(structuredClone(a.profile));
    a.profile = next;
    a.profile.version = c.version.nutrition;
    a.profile.effectiveFrom = today;
    if (a.profile.goal) a.stageGoal = a.profile.goal;
    delete a.pendingEnergy;
  } else if (action === 'profileRatios') {
    need(a.profile, '请先保存饮食目标');
    const checked = R.profile({ ...a.profile, estimate: false, goal: undefined, energyModel: undefined, ratios: b.ratios }, c.nutrition);
    a.profile.ratios = checked.ratios;
    if (a.pendingEnergy) a.pendingEnergy.profile.ratios = [...checked.ratios];
  } else if (action === 'measurement') {
    R.day(b.date);
    need(b.date <= today && b.date >= E.shift(today, -365), '请选择最近一年内的日期');
    need(Number.isFinite(b.weight) && b.weight >= 25 && b.weight <= 350, '请填写25至350千克之间的体重');
    if (b.waist != null) need(Number.isFinite(b.waist) && b.waist >= 30 && b.waist <= 250, '腰围须为30至250厘米');
    (a.measurements ||= {})[b.date] = { date: b.date, weight: b.weight, waist: b.waist ?? null };
  } else if (action === 'energyFeedback') {
    R.day(b.date);
    need(b.date <= today && b.date >= E.shift(today, -13), '请填写最近两周的执行反馈');
    need(['基本按计划','偏多','偏少','未记录'].includes(b.adherence) && ['正常','明显饥饿或疲劳','训练表现下降'].includes(b.wellbeing), '请选择执行情况与身体感受');
    (a.energyFeedback ||= {})[b.date] = { date: b.date, adherence: b.adherence, wellbeing: b.wellbeing, waterChange: b.waterChange === true };
  } else if (action === 'acceptEnergy') {
    const result = E.progress(a, c.nutrition.goalPolicy, today), r = result.recommendation;
    need(r && r.id === b.id, '调整建议已变化，请刷新后重新确认');
    const profile = structuredClone(a.profile);
    profile.targets = r.targets;
    profile.effectiveFrom = r.effectiveFrom;
    profile.energy.difference = r.targets.kcal - profile.energy.maintenance;
    profile.energy.adjustment = { delta: r.delta, reason: result.reason, acceptedAt: new Date(now).toISOString(), policyVersion: c.version.nutrition };
    (a.energyHistory ||= []).push(structuredClone(a.profile));
    a.pendingEnergy = { profile, effectiveFrom: r.effectiveFrom };
  } else if (action === 'cancelEnergy') {
    need(a.pendingEnergy, '没有待生效的调整');
    delete a.pendingEnergy;
  } else if (action === 'consumeMeal') {
    R.day(b.date);
    need(b.date <= today, '不能提前记为已吃');
    const meal = a.meals[b.date + '-' + b.index];
    need(meal, '请先保存实际份量的搭配');
    if (b.remove) delete (a.consumedMeals ||= {})[b.date + '-' + b.index];
    else (a.consumedMeals ||= {})[b.date + '-' + b.index] = { ...structuredClone(meal), confirmedAt: new Date(now).toISOString() };
  } else if (action === 'saveMeal') {
    need(a.profile, '请先保存饮食资料');
    R.day(b.date);
    need(b.version === c.version.foods, '食材已更新，请重新试算', 409);
    a.meals[b.date + '-' + b.index] = {
      ...R.meal(a.profile, b.index, b.items, c.foods, c.risk),
      foodsVersion: c.version.foods,
      nutritionVersion: c.version.nutrition,
      date: b.date
    };
  } else need(false, '未知操作');
}
module.exports = { prepare, change };
