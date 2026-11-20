'use strict';
const { types } = require('../微信小程序/miniprogram/lib/workout-types');
const source = 'https://pacompendium.com/wp-content/uploads/2024/02/1_2024-adult-compendium_1_2024.pdf';
function tick(s, now) {
  const t = s.timer;
  if (!t?.running) return;
  const delta = Math.max(0, now - t.lastBeat);
  // Heartbeats are sent every 30s. An abandoned/hidden app cannot add hours of activity.
  t.seconds += Math.min(delta, 60000) / 1000;
  if (delta > 90000) t.running = false;
  t.lastBeat = now;
}
function estimate(s) {
  const type = types[s.workoutType], p = s.energyPerson;
  if (!type || !p || !Number.isInteger(p.age) || p.age < 18 || !Number.isFinite(p.weight) || !(p.weight > 0) || !s.timer?.seconds)
    return { available: false, reason: '缺少适用的活动类型、身体资料或有效计时，暂无法估算' };
  if (p.age >= 65 && !p.ageAcknowledged) return { available: false, reason: '65岁及以上需确认估算局限后继续' };
  const hours = s.timer.seconds / 3600;
  const older = p.age >= 60 && type.older;
  const met = older ? type.older.met : type.met;
  // MET60+ uses 2.7 ml/kg/min, not the adult 3.5 baseline. Use oxygen
  // conversion for that table; keep the existing adult kcal/kg/hour approximation.
  const scale = older ? 2.7 * 60 * .005 : 1;
  const limitation = p.age === 18 || (p.age >= 60 && !older) ? '该年龄采用成人活动条目外推，误差可能较大。' : '';
  return { available: true, gross: Math.round(met * scale * p.weight * hours), net: Math.round((met - 1) * scale * p.weight * hours), seconds: Math.round(s.timer.seconds), weight: p.weight, met, metBasis: older ? 'MET60+（2.7 ml/kg/min）' : '成人MET近似', type: type.label, code: older ? type.older.code : type.code, source: older ? 'https://pacompendium.com/older-adult-compendium/' : source, note: (type.aerobic ? '按所选活动持续时间估算；停下休息请暂停。' : '含通常组间休息；长时间离开请暂停。') + limitation + '仅活动估算，不增加饮食额度。' };
}
module.exports = { types, tick, estimate };
