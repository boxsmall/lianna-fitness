'use strict';
const { moves, need, goals, metrics, gearList } = require('./rules');
const patterns = {
  全身: ['蹲', '髋', '推', '拉', '核心'],
  '全身 A': ['蹲', '推', '拉'],
  '全身 B': ['髋', '拉', '辅助', '核心'],
  上肢: ['推', '拉', '辅助'],
  下肢: ['蹲', '髋', '核心']
};
const defaults = {
  actions: Object.entries({
    蹲: ['1760', '2368'],
    髋: ['1459', '3013'],
    推: ['0662', '2398'],
    拉: ['0293', '0292', '0327', '0988'],
    核心: ['0274'],
    辅助: ['0334', '3239'],
    有氧: ['0798', '3672'],
    热身: ['0257', '1167', '1368', '1017']
  }).flatMap(([pattern, ids]) =>
    ids.map((id) => ({
      id,
      name: moves.get(id).name,
      pattern,
      level: '基础',
      approved: false,
      enabled: true,
      unit: pattern === '热身' || pattern === '有氧' ? '秒' : '次',
      target: pattern === '热身' ? 60 : pattern === '有氧' ? 90 : 10,
      seconds: 3,
      rest: 45
    }))
  ),
  templates: {
    enabled: true,
    dates: [
      [2],
      [1, 4],
      [0, 2, 4],
      [0, 1, 3, 4],
      [0, 1, 2, 3, 4],
      [0, 1, 2, 3, 4, 5],
      [0, 1, 2, 3, 4, 5, 6]
    ],
    patterns,
    sets: { 增肌: 3, 减脂: 2, 日常健身: 2 }
  },
  foods: require('./foods.json'),
  nutrition: {
    goalPolicy: require('./energy').defaults,
    macroRatio: [55, 20, 25],
    estimation: {
      approved: false,
      weight: 10,
      height: 6.25,
      age: -5,
      offset: { 男: 5, 女: -161 },
      activity: { 久坐: 1.2, 轻活动: 1.375, 中等活动: 1.55 },
      source: '待营养审核，启用前须核对适用人群和计算依据'
    }
  },
  ai: {
    model: 'deepseek-flash',
    prompt: '仅从给定候选编号中推荐本餐食材，输出 JSON 数组，每项包含 id、reason。',
    dailyLimit: 0,
    pricePerMillionInput: 0,
    pricePerMillionOutput: 0
  }
};
for (const a of defaults.actions) {
  a.visible = true;
  a.replacements = defaults.actions
    .filter((x) => x.id !== a.id && x.pattern === a.pattern)
    .map((x) => x.id);
}
function validate(module, value) {
  need(Object.hasOwn(defaults, module), '模块不存在');
  if (module === 'actions') {
    need(
      Array.isArray(value) && new Set(value.map((a) => a.id)).size === value.length,
      '动作编号重复'
    );
    for (const a of value) {
      need(moves.has(a.id) && a.id === moves.get(a.id).sourceId, '请使用原始动作编号');
      need(typeof a.enabled === 'boolean' && typeof a.approved === 'boolean', '动作状态无效');
      if (a.gear)
        need(Array.isArray(a.gear) && a.gear.every((g) => gearList.includes(g)), '存在未登记器械');
      if (a.alternatives)
        need(
          Object.entries(a.alternatives).every(
            ([k, v]) =>
              gearList.includes(k) && Array.isArray(v) && v.every((g) => gearList.includes(g))
          ),
          '替代器械无效'
        );
      if (a.approved) {
        need(
          a.pattern && ['基础', '进阶'].includes(a.level) && ['秒', '次'].includes(a.unit),
          '请补齐动作模式、难度和计量单位'
        );
        need(
          [a.target, a.seconds, a.rest].every((n) => Number.isInteger(n) && n >= 0) &&
            a.target > 0 &&
            a.seconds > 0,
          '时长与次数无效'
        );
      }
      for (const id of a.replacements || []) need(moves.has(id), '替代动作不存在');
      if (a.steps)
        need(
          Array.isArray(a.steps) &&
            a.steps.length &&
            a.steps.every((t) => typeof t === 'string' && t.trim()),
          '说明不能为空'
        );
      if (a.media) {
        need(
          ['cover', 'animation'].every(
            (k) =>
              typeof a.media[k] === 'string' &&
              /^https:\/\//.test(a.media[k]) &&
              /^[a-f0-9]{40}$/.test(a.media[k + 'Hash'] || '')
          ),
          '封面和演示须成套提供 HTTPS 地址及 SHA-1 摘要'
        );
      }
    }
  } else if (module === 'foods') {
    need(
      Array.isArray(value) && new Set(value.map((f) => f.id)).size === value.length,
      '食材编号重复'
    );
    for (const f of value) {
      need(
        f.id &&
          f.name &&
          Array.isArray(f.checked) &&
          Array.isArray(f.contains) &&
          Array.isArray(f.tags),
        '食材标记无效'
      );
      if (f.enabled)
        need(
          f.state &&
            f.source &&
            f.sourceVersion &&
            metrics.every((k) => Number.isFinite(f[k]) && f[k] >= 0) &&
            ['carb', 'protein', 'fat'].includes(f.primary) &&
            f[f.primary] > 0,
          '食材缺少来源、称重口径或每百克营养数据'
        );
    }
  } else if (module === 'templates') {
    need(
      Array.isArray(value.dates) &&
        value.dates.length === 7 &&
        value.dates.every(
          (v, i) =>
            Array.isArray(v) &&
            v.length === i + 1 &&
            new Set(v).size === v.length &&
            v.every((n) => Number.isInteger(n) && n >= 0 && n < 7)
        ),
      '模板的训练日无效'
    );
    need(
      Object.keys(patterns).every(
        (k) =>
          Array.isArray(value.patterns[k]) &&
          value.patterns[k].length &&
          value.patterns[k].every((p) =>
            Object.keys(patterns)
              .flatMap((k) => patterns[k])
              .includes(p)
          )
      ),
      '动作模式无效'
    );
    need(
      goals.every(
        (g) => Number.isInteger(value.sets[g]) && value.sets[g] >= 1 && value.sets[g] <= 12
      ),
      '模板组数无效'
    );
  } else if (module === 'nutrition') {
    if (value.goalPolicy) require('./energy').validate(value.goalPolicy);
    if (value.macroRatio === null && !value.estimation?.approved) return;
    need(
      Array.isArray(value.macroRatio) &&
        value.macroRatio.length === 3 &&
        value.macroRatio.every((n) => n > 0) &&
        value.macroRatio.reduce((a, b) => a + b, 0) === 100,
      '营养比例之和须为100'
    );
    const e = value.estimation;
    if (e?.approved)
      need(
        [e.weight, e.height, e.age, e.offset?.男, e.offset?.女].every(Number.isFinite) &&
          e.source &&
          Object.values(e.activity || {}).length &&
          Object.values(e.activity).every((n) => Number.isFinite(n) && n > 0),
        '估算规则缺少审核依据或参数'
      );
  } else {
    for(const [key,min,max] of [['maxRetries',0,2],['timeoutMs',1000,60000],['maxInputTokens',512,64000],['maxOutputTokens',128,8192],['userDailyLimit',0,100000]]) if(value[key]!=null) need(Number.isInteger(value[key])&&value[key]>=min&&value[key]<=max,'AI 参数无效：'+key);
    for(const key of ['dailyBudget','pricePerMillionCache']) if(value[key]!=null) need(Number.isFinite(value[key])&&value[key]>=0&&value[key]<=100000,'金额配置无效');
    if(value.fallbackModel){need(['deepseek-flash','deepseek-v4-pro'].includes(value.fallbackModel)&&value.fallbackModel!==value.model,'备用模型须为另一款 DeepSeek 模型');for(const k of ['fallbackInput','fallbackOutput'])need(Number.isFinite(value[k])&&value[k]>=0,'请填写备用模型独立价格');if(value.fallbackCache!=null)need(Number.isFinite(value.fallbackCache)&&value.fallbackCache>=0,'缓存价格无效')}
    need(
      typeof value.prompt === 'string' &&
        typeof value.model === 'string' &&
        Number.isInteger(value.dailyLimit) &&
        value.dailyLimit >= 0 &&
        [value.pricePerMillionInput, value.pricePerMillionOutput].every(
          (n) => Number.isFinite(n) && n >= 0
        ),
      'AI 配置无效'
    );
  }
}
module.exports = { defaults, validate };
