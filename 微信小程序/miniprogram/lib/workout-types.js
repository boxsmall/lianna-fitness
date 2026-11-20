// Source activity labels are intentionally specific: a generic aerobic session
// does not imply a known intensity, and mixed sessions are not estimated.
const types = {
  resistance: { label: '常规多动作抗阻训练（每组8～15次）', met: 3.5, code: '02054', older: { met: 4.3, code: '0205460' } },
  bodyweight: { label: '常规自重训练', met: 3, code: '02056' },
  walking: { label: '有氧 · 平地步行（4.5～5.1 km/h）', met: 3.8, code: '17190', older: { met: 5.3, code: '1719060' }, aerobic: true },
  jogging: { label: '有氧 · 慢跑（自选配速，粗略估算）', met: 7.5, code: '12020', aerobic: true },
  cycling: { label: '有氧 · 固定自行车（50瓦）', met: 4, code: '01214', older: { met: 4.3, code: '0101160' }, aerobic: true }
};
module.exports = { types, keys: ['', ...Object.keys(types)], labels: ['不估算 / 混合训练', ...Object.values(types).map(t=>t.label)] };
