'use strict';
const R = require('./rules');
const { need } = R;
function prepare(a, input, c) {
  const args = { ...input, anchor: Object.keys(a.weeks).sort()[0] || input.start };
  return R.plan(args, c, a.prefs, a.sessions);
}
function change(a, action, b, c) {
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
    }
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
      goal: '日常健身', days: 1, minutes: target.budget, gear: [...gear],
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
    a.profile = R.profile(b, c.nutrition);
    a.profile.version = c.version.nutrition;
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
