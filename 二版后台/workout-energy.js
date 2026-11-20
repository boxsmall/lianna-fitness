'use strict';
const types = { resistance: { label: '常规多动作抗阻训练', met: 3.5, code: '02054' }, bodyweight: { label: '常规自重训练', met: 3, code: '02056' } };
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
  if (!type || !p || p.age < 19 || p.age > 59 || !(p.weight > 0) || !s.timer?.seconds)
    return { available: false, reason: '缺少适用的活动类型、身体资料或有效计时，暂无法估算' };
  const hours = s.timer.seconds / 3600;
  return { available: true, gross: Math.round(type.met * p.weight * hours), net: Math.round((type.met - 1) * p.weight * hours), seconds: Math.round(s.timer.seconds), weight: p.weight, met: type.met, type: type.label, code: type.code, source, note: '含通常组间休息；长时间离开请暂停。仅活动估算，不增加饮食额度。' };
}
module.exports = { types, tick, estimate };
