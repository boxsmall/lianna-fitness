'use strict';
const { createHash } = require('node:crypto');
const need = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { status: 400 }); };
const goals = ['减脂', '维持', '增肌'];
const defaults = {
  approved: false, deficit: 0.15, surplus: 0.05, proteinPerKg: 1.6, fatPercent: 25,
  floorMale: 1500, floorFemale: 1200, adjustment: 100, observationDays: 14, minSamples: 3,
  source: 'Mifflin-St Jeor: https://pubmed.ncbi.nlm.nih.gov/2305711/；蛋白质：https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/；缺口15%、盈余5%为产品起点，结合执行与体重趋势复核。通用方案限18至64岁、BMI 18.5至不足30的一般健康非孕哺期成人。'
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
function calculate(input, rules, resting, maintenance) {
  const p = rules.goalPolicy;
  need(p?.approved, '目标饮食规则尚未发布，请先使用已有专业目标');
  validate(p);
  need(goals.includes(input.goal), '请选择减脂、维持或增肌目标');
  need(input.generalAdult === true && input.age >= 18 && input.age <= 64, '通用方案适用于18至64岁一般健康成年人，请使用专业目标');
  need(input.height >= 100 && input.height <= 250 && input.weight >= 25 && input.weight <= 350, '请核对身高厘米、体重千克，或使用专业目标');
  const bmi = input.weight / (input.height / 100) ** 2;
  need(bmi >= 18.5 && bmi < 30, '当前身体资料超出通用营养分配范围，请使用专业目标');
  need(input.goal !== '增肌' || input.resistance === true, '增肌方案需要配合抗阻训练，请确认通常训练情况');
  const factor = input.goal === '减脂' ? 1 - p.deficit : input.goal === '增肌' ? 1 + p.surplus : 1;
  const kcal = Math.round(maintenance * factor);
  need(kcal >= (input.sex === '男' ? p.floorMale : p.floorFemale), '目标低于自动方案下限，请使用专业目标，不应继续压低饮食');
  return {
    targets: macros(kcal, input.weight, p, input.resistance === true, rules.macroRatio),
    energy: { model: 'goal-v1', resting: Math.round(resting), maintenance: Math.round(maintenance),
      activityFactor: rules.estimation.activity[input.activity], factor, difference: kcal - Math.round(maintenance),
      includesTraining: true, source: rules.estimation.source, policy: structuredClone(p), macroRatio: [...rules.macroRatio] }
  };
}
function checkTargets(t) {
  const derived = t.carb * 4 + t.protein * 4 + t.fat * 9;
  need(Math.abs(t.kcal - derived) <= 10, '三类营养合计约' + Math.round(derived) + '千卡，与每日目标不一致，请调整（允许10千卡取整误差）');
}
function progress(a, policy, today = date()) {
  const records = Object.values(a.measurements || {}).filter(r => r.date <= today).sort((x,y) => x.date.localeCompare(y.date));
  const windows = [[shift(today,-13),shift(today,-7)],[shift(today,-6),today]];
  const samples = windows.map(([lo, hi]) => records.filter(r => r.date >= lo && r.date <= hi));
  const means = samples.map(rows => rows.length ? rows.reduce((sum,r) => sum+r.weight,0)/rows.length : null);
  const result = { records: records.slice(-90).reverse(), counts: samples.map(r=>r.length), means: means.map(n=>n==null?null:Math.round(n*100)/100), reason: '记录不足：相邻两周各记录至少' + (policy?.minSamples || 3) + '天体重', recommendation: null, pending: a.pendingEnergy ? { effectiveFrom: a.pendingEnergy.effectiveFrom, targets: a.pendingEnergy.profile.targets } : null };
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
  const f = windows.map(([lo, hi]) => feedback.filter(r=>r.date>=lo && r.date<=hi));
  if (f.some(rows=>!rows.length)) { result.reason = '请补充每周饮食执行与身体感受，再评估调整'; return result; }
  if (f.flat().some(r=>r.wellbeing!=='正常' || r.waterChange)) { result.reason = '存在不适或短期体重波动，暂不减量，请复核方案'; return result; }
  if (f.flat().some(r=>r.adherence!=='基本按计划')) { result.reason = '先核对饮食份量与活动变化，暂不调整热量'; return result; }
  const rate = (means[1]-means[0])/means[0];
  if (Math.abs(rate) > .01) { result.reason = '体重变化较快，请复核饮食、身体感受和训练表现，暂不自动调整'; return result; }
  let delta = 0;
  if (p.goal==='减脂' && rate > -.001) delta = -policy.adjustment;
  if (p.goal==='增肌' && rate < .001) delta = policy.adjustment;
  if (p.goal==='维持' && Math.abs(rate) > .0025) delta = rate > 0 ? -policy.adjustment : policy.adjustment;
  if (!delta) return result;
  const kcal = p.targets.kcal + delta;
  const lower = Math.max(p.sex==='男'?policy.floorMale:policy.floorFemale, p.energy.maintenance*.75);
  if (kcal < lower || kcal > p.energy.maintenance*1.15) { result.reason = '已达到通用调整边界，请复核或使用专业目标'; return result; }
  const targets = macros(kcal, p.weight, p.energy.policy, p.resistance, p.energy.macroRatio);
  result.reason = delta < 0 ? '两周趋势与执行反馈支持小幅减量，先检查额外饮食和活动变化' : '两周趋势与执行反馈支持小幅增加饮食';
  const id = createHash('sha256').update(JSON.stringify({today,p,records,feedback,policy})).digest('hex').slice(0,24);
  result.recommendation = { id, delta, targets, effectiveFrom: shift(today,1) };
  return result;
}
module.exports = { defaults, validate, goals, date, shift, effective, macros, calculate, checkTargets, progress };
