'use strict';
const { createHash } = require('node:crypto');
const need = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { status: 400 }); };
const goals = ['减脂', '维持', '增肌'];
const defaults = {
  approved: false, deficit: 0.15, surplus: 0.05, proteinPerKg: 1.6, fatPercent: 25,
  floorMale: 1500, floorFemale: 1200, adjustment: 100, observationDays: 14, minSamples: 3,
  source: 'Mifflin-St Jeor: https://pubmed.ncbi.nlm.nih.gov/2305711/；蛋白质：https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/；缺口15%、盈余5%为可调整的产品起点，结合执行与体重趋势复核。一般健康非孕哺期成人；65岁及以上确认估算局限，BMI仅作参考。'
};
function validate(p) {
  need(p && typeof p.approved === 'boolean', '目标策略状态无效');
  for (const [key, lo, hi] of [['deficit', .05, .25], ['surplus', 0, .1], ['proteinPerKg', 1.4, 2], ['fatPercent', 20, 35], ['floorMale', 1500, 2500], ['floorFemale', 1200, 2200], ['adjustment', 50, 150], ['observationDays', 14, 28], ['minSamples', 3, 7]])
    need(Number.isFinite(p[key]) && p[key] >= lo && p[key] <= hi, '目标策略参数无效：' + key);
  for (const key of ['adjustment', 'observationDays', 'minSamples']) need(Number.isInteger(p[key]), '策略须为整数：' + key);
  need(typeof p.source === 'string' && p.source.trim().length >= 10, '请填写目标策略依据与适用范围');
}
const date = (now = new Date()) => new Date(new Date(now).getTime() + 8 * 3600000).toISOString().slice(0, 10);
const shift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
function effective(a, today = date()) {
  if (a.pendingEnergy && a.pendingEnergy.effectiveFrom <= today) {
    a.profile = a.pendingEnergy.profile;
    a.stageGoal = a.profile.goal;
    delete a.pendingEnergy;
  }
  return a;
}
function macros(kcal, weight, p, resistance, ratio) {
  const protein = Math.round(resistance ? weight * p.proteinPerKg : kcal * ratio[1] / 400);
  const fat = Math.round(kcal * (resistance ? p.fatPercent : ratio[2]) / 900);
  const carb = (kcal - protein * 4 - fat * 9) / 4;
  need(carb > 0 && protein > 0 && fat > 0, '当前能量不足以分配营养目标，请使用专业目标');
  return { kcal: Math.round(kcal), protein: Math.round(protein), fat: Math.round(fat), carb: Math.round(carb) };
}
function calculate(input, rules, resting, maintenance, preview = false) {
  const p = rules.goalPolicy;
  need(p?.approved, '目标饮食规则尚未发布，请先使用已有专业目标');
  validate(p);
  need(goals.includes(input.goal), '请选择减脂、维持或增肌目标');
  need(Number.isInteger(input.age) && input.age >= 18, '通用估算面向成年人，未成年人请填写已有专业目标');
  need(preview || input.age < 65 || input.ageAcknowledged === true, '65岁及以上需确认估算局限后继续');
  const bmi = input.weight / (input.height / 100) ** 2;
  const percent = input.goalPercent == null ? (input.goal === '减脂' ? p.deficit : input.goal === '增肌' ? p.surplus : 0) * 100 : input.goalPercent;
  need(Number.isFinite(percent) && (input.goal === '减脂' ? percent >= 5 && percent <= 25 : input.goal === '增肌' ? percent >= 0 && percent <= 10 : percent === 0), '请核对目标比例：减脂5%～25%，增肌0%～10%，维持0%');
  const factor = input.goal === '减脂' ? 1 - percent / 100 : input.goal === '增肌' ? 1 + percent / 100 : 1;
  const kcal = Math.round(maintenance * factor);
  need(Number.isFinite(kcal) && kcal > 0, '计算结果无效，请核对资料和单位');
  const threshold = input.sex === '男' ? p.floorMale : p.floorFemale;
  const reviewRequired = kcal < threshold;
  const reviewReason = reviewRequired ? `计算结果${kcal}千卡低于自动推荐复核阈值${threshold}千卡，暂停自动配餐。该阈值不是个人安全下限，可填写已有专业目标。` : '';
  need(preview || !reviewRequired, reviewReason);
  return {
    reviewRequired, reviewReason,
    targets: reviewRequired ? { kcal } : macros(kcal, input.weight, p, input.resistance === true, rules.macroRatio),
    energy: { model: 'goal-v1', algorithm: 'confirmed-20261120', resting: Math.round(resting), maintenance: Math.round(maintenance),
      bmi: Number.isFinite(bmi) ? Math.round(bmi * 100) / 100 : null, goalPercent: percent,
      ageNotice: input.age >= 65 ? '65岁及以上的身体组成和活动差异可能影响估算，本结果仅为起点，需结合实际趋势复核。' : '',
      activityFactor: rules.estimation.activity[input.activity], factor, difference: kcal - Math.round(maintenance),
      includesTraining: true, source: rules.estimation.source, policy: structuredClone(p), macroRatio: [...rules.macroRatio] }
  };
}
function checkTargets(t) {
  const derived = t.carb * 4 + t.protein * 4 + t.fat * 9;
  need(Math.abs(t.kcal - derived) <= 10, '三类营养合计约' + Math.round(derived) + '千卡，与每日目标不一致，请调整（允许10千卡取整误差）');
}
function progress(a, policy, today = date(), query = {}) {
  const records = Object.values(a.measurements || {}).filter(r => r.date <= today).sort((x,y) => x.date.localeCompare(y.date));
  const windows = [[shift(today,-13),shift(today,-7)],[shift(today,-6),today]];
  const samples = windows.map(([lo, hi]) => records.filter(r => r.date >= lo && r.date <= hi));
  const means = samples.map(rows => rows.length ? rows.reduce((sum,r) => sum+r.weight,0)/rows.length : null);
  const filtered = records.filter(r => (!query.from || r.date >= query.from) && (!query.to || r.date <= query.to)).reverse();
  const offset = Number.isInteger(query.offset) && query.offset >= 0 ? query.offset : 0;
  const result = { records: filtered.slice(offset,offset+90).map(({date,weight})=>({date,weight})), totalRecords: filtered.length, nextOffset: offset+90 < filtered.length ? offset+90 : null, counts: samples.map(r=>r.length), means: means.map(n=>n==null?null:Math.round(n*100)/100), reason: '记录不足：相邻两周各记录至少' + (policy?.minSamples || 3) + '天体重', recommendation: null, pending: a.pendingEnergy ? { effectiveFrom: a.pendingEnergy.effectiveFrom, targets: a.pendingEnergy.profile.targets } : null };
  if (samples.some(r=>r.length < (policy?.minSamples || 3))) return result;
  result.change = Math.round((means[1]-means[0])*100)/100;
  result.reason = '继续按当前方案执行，观察趋势';
  const p = a.profile;
  if (!p?.energy || !p.estimate) { result.reason = '已有专业目标或旧版目标，暂不自动调整'; return result; }
  if (p.targetWeight && ((p.goal === '减脂' && means[1] <= p.targetWeight) || (p.goal === '增肌' && means[1] >= p.targetWeight))) {
    result.goalReached = true;
    result.reason = '近期平均体重已达到阶段体重，可进入目标设置重新评估维持方案；体重达标不等于体脂达标';
    return result;
  }
  if (!policy?.approved) { result.reason = '目标调整规则尚未发布'; return result; }
  if (a.pendingEnergy) { result.reason = '已有明日生效的目标'; return result; }
  if (!p.effectiveFrom || shift(p.effectiveFrom, policy.observationDays) > today) { result.reason = '新目标仍在观察期，暂不调整'; return result; }
  const feedback = Object.values(a.energyFeedback || {});
  const rate = (means[1]-means[0])/means[0];
  if (Math.abs(rate) > .01) { result.reason = '体重变化较快，请复核饮食、身体感受和训练表现，暂不自动调整'; return result; }
  let delta = 0;
  if (p.goal==='减脂' && rate > -.001) delta = -policy.adjustment;
  if (p.goal==='增肌' && rate < .001) delta = policy.adjustment;
  if (p.goal==='维持' && Math.abs(rate) > .0025) delta = rate > 0 ? -policy.adjustment : policy.adjustment;
  if (!delta) return result;
  const assessment = a.energyAssessment;
  if (!assessment || assessment.date !== today || assessment.effectiveFrom !== p.effectiveFrom) {
    result.needsAssessment = true; result.reason = '体重记录已足够，请确认近期整体执行情况及当前身体感受后再评估'; return result;
  }
  if (assessment.waterStatus !== '无影响') { result.reason = '短期波动仍有影响或尚不确定，暂缓调整建议'; return result; }
  if (assessment.adherence !== '基本按计划') { result.reason = '先核对近期整体饮食份量与活动变化，暂不调整热量'; return result; }
  if (delta < 0 && assessment.wellbeing !== '正常') { result.reason = '不适仍存在，暂停自动减量，请复核方案'; return result; }
  const kcal = p.targets.kcal + delta;
  const lower = Math.max(p.sex==='男'?policy.floorMale:policy.floorFemale, p.energy.maintenance*.75);
  if (kcal < lower || kcal > p.energy.maintenance*1.15) { result.reason = '已触及自动调整边界，请重新评估维持热量或填写已有专业目标'; result.reviewRequired = true; return result; }
  const targets = macros(kcal, p.weight, p.energy.policy, p.resistance, p.energy.macroRatio);
  result.reason = delta < 0 ? '两周趋势与执行反馈支持小幅减量，先检查额外饮食和活动变化' : '两周趋势与执行反馈支持小幅增加饮食';
  const id = createHash('sha256').update(JSON.stringify({today,p,records,feedback,assessment,policy})).digest('hex').slice(0,24);
  result.recommendation = { id, delta, targets, effectiveFrom: shift(today,1) };
  return result;
}
module.exports = { defaults, validate, goals, date, shift, effective, macros, calculate, checkTargets, progress };
