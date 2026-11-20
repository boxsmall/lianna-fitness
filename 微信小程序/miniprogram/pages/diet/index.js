const api = require('../../lib/service');
const mealNames = ['早餐', '午餐', '晚餐', '加餐'];
const split = (v) =>
  String(v || '')
    .split(/[、,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
const nav = require('../../lib/navigation');
const display = require('../../lib/presentation');
const commonAllergens = ['花生', '牛奶', '鸡蛋', '大豆', '虾蟹'];
const allergenOptions = (value) =>
  commonAllergens.map((name) => ({
    name,
    checked: split(value).includes(name)
  }));
const foodTypes = [
  ['carb', '主食'],
  ['protein', '肉类或蛋白质来源'],
  ['fat', '脂肪来源']
];
Page({
  follow: nav.follow,
  goal(e) { this.setData({ 'form.goal': e.currentTarget.dataset.value }); },
  explain() {
    const e = this.profile?.energy;
    api.alert(e ? '静息估算 ' + e.resting + ' 千卡 × 活动系数 ' + e.activityFactor + ' ≈ 维持消耗 ' + e.maintenance + ' 千卡。当前' + this.profile.goal + '饮食目标 ' + this.profile.targets.kcal + ' 千卡。已考虑通常训练，不再加回单次运动消耗。估算需结合体重趋势评估。' : '这是原已确认目标或已有专业目标。选择“帮我估算”可按当前阶段目标重新评估。');
  },
  consume() {
    api.run(this, async () => {
      if (!(await api.confirm('按实际份量记为已吃', '请先保存实际吃下的食材与克数；确认后按这份搭配记入摄入记录。'))) return;
      await api.mutate('consumeMeal', { date: this.data.date, index: this.data.index });
      await this.loadMeal();
    });
  },
  unconsume() {
    api.run(this, async () => { await api.mutate('consumeMeal', { date: this.data.date, index: this.data.index, remove: true }); await this.loadMeal(); });
  },
  toggleAllergen(e) {
    const n = e.currentTarget.dataset.name;
    const old = split(this.data.form.allergens);
    const v = (
      old.includes(n) ? old.filter((x) => x !== n) : old.concat(n)
    ).join('、');
    this.setData({ 'form.allergens': v, allergenOptions: allergenOptions(v) });
  },
  screen(e) {
    this.setData({ mode: e.currentTarget.dataset.mode, error: '' });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  sex(e) {
    this.setData({ 'form.sex': e.currentTarget.dataset.value });
  },
  estimate(e) {
    this.setData({ 'form.estimate': e.currentTarget.dataset.value === 1 });
  },
  next() {
    const f = this.data.form;
    if (!f.sex || !(Number(f.height) > 0) || !(Number(f.weight) > 0)) {
      this.setData({ error: '请填写性别、有效身高和体重。' });
      return;
    }
    this.setData({ mode: 'energy', error: '' });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  editRatios() {
    this.setData({ ratioDraft: this.data.form.ratios, ratioOpen: true });
  },
  ratioInput(e) {
    this.setData({ ratioDraft: e.detail.value });
  },
  closeRatios() {
    this.setData({ ratioOpen: false });
  },
  saveRatios() {
    api.run(this, async () => {
      const a = await api.mutate('profileRatios', {
        ratios: split(this.data.ratioDraft).map(Number)
      });
      this.adopt(a.profile);
      this.setData({ ratioOpen: false });
      await this.loadMeal();
    });
  },
  adopt(p) {
    this.profile = p;
    const latest = Object.values(api.state()?.measurements || {}).sort((a,b)=>b.date.localeCompare(a.date))[0];
    this.setData({
      editing: false,
      legacy: !p.energyModel,
      pending: api.state()?.pendingEnergy || null,
      allergenOptions: allergenOptions(p.allergens),
      meals: display.meals(p),
      form: {
        ...this.data.form,
        ...p,
        ...p.targets,
        weight: latest?.weight || p.weight,
        goal: p.goal || api.state()?.stageGoal || '维持',
        useManualMacros: p.macroMode === 'manual' || (!p.estimate && !p.macroMode),
        ratios: p.ratios.join(','),
        allergens: p.allergens.join('、'),
        avoid: p.avoid.join('、')
      }
    });
  },
  data: {
    mode: 'nutrition',
    mealNames,
    allergenOptions: allergenOptions(''),
    index: 0,
    date: '',
    editing: true,
    form: {
      sex: '',
      height: '',
      weight: '',
      kcal: '',
      carb: '',
      protein: '',
      fat: '',
      ratios: '30,40,30',
      allergens: '',
      avoid: '',
      estimate: false,
      goal: '减脂',
      resistance: false,
      targetWeight: '',
      useManualMacros: false,
      age: '',
      activity: '久坐',
      generalAdult: false
    },
    sexes: ['女', '男'],
    goals: ['减脂', '维持', '增肌'],
    levels: ['久坐', '轻活动', '中等活动'],
    foods: [],
    hasFoods: false,
    showFoods: false,
    replaceId: '',
    choice: 0,
    items: [],
    result: null,
    error: '',
    recommendations: []
  },
  onLoad(q) {
    this.initial = q;
  },
  onShow() {
    const q = nav.take('diet') || this.initial || {};
    this.initial = null;
    this.setData({
      date: api.localDate(),
      index: Number(q.meal) || 0,
      mode: q.mode || 'nutrition',
      error: '',
      ratioOpen: false,
      showFoods: false
    });
    this.open();
  },
  async open() {
    try {
      const a = api.credentials() ? await api.refresh() : null;
      if (a?.profile) {
        this.adopt(a.profile);
        if (this.data.mode === 'meal') await this.loadMeal();
      } else {
        this.profile = null;
        this.setData({ editing: true, mode: 'profile', result: null, 'form.goal': a?.stageGoal || '减脂' });
      }
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  input(e) {
    const key = e.currentTarget.dataset.k;
    this.setData({
      ['form.' + key]: e.detail.value,
      ...(key === 'allergens'
        ? { allergenOptions: allergenOptions(e.detail.value) }
        : {})
    });
  },
  pick(e) {
    const { k, list } = e.currentTarget.dataset;
    this.setData({ ['form.' + k]: this.data[list][Number(e.detail.value)] });
  },
  edit() {
    this.setData({ editing: true });
  },
  profileArgs() {
    const f = this.data.form,
      targets = { kcal: Number(f.kcal) };
    if (!f.estimate && f.useManualMacros) for (const k of ['carb', 'protein', 'fat'])
      if (f[k] !== '' && f[k] != null) targets[k] = Number(f[k]);
    return {
      energyModel: 'goal-v1',
      goal: f.goal,
      resistance: !!f.resistance,
      targetWeight: f.targetWeight === '' || f.targetWeight == null ? null : Number(f.targetWeight),
      sex: f.sex,
      height: Number(f.height),
      weight: Number(f.weight),
      targets,
      ratios: split(f.ratios).map(Number),
      allergens: split(f.allergens),
      avoid: split(f.avoid),
      estimate: !!f.estimate,
      age: Number(f.age),
      activity: f.activity,
      generalAdult: !!f.generalAdult
    };
  },
  saveProfile() {
    api.run(this, async () => {
      const args = this.profileArgs(),
        profile = await api.request('profile/preview', args);
      args.version = profile.version;
      if (
        !(await api.confirm(
          profile.estimate ? '确认' + profile.goal + '方案' : '确认饮食目标',
          (profile.energy ? '维持消耗估算 ' + profile.energy.maintenance + ' 千卡；' : '') + '每日饮食 ' +
            profile.targets.kcal +
            ' 千卡，碳水 ' +
            profile.targets.carb +
            ' g、蛋白质 ' +
            profile.targets.protein +
            ' g、脂肪 ' +
            profile.targets.fat +
            ' g。保存后作为新的阶段目标，新建训练默认使用；原已保存训练不会覆盖。'
        ))
      )
        return;
      if (!(await api.login())) return;
      const a = await api.mutate('profile', args);
      this.adopt(a.profile);
      this.setData({ mode: 'nutrition' });
      await this.loadMeal();
    });
  },
  async loadMeal() {
    this.generationId = undefined;
    const { index, date } = this.data;
    const r = await api.request('foods', this.profile),
      old = api.state()?.meals[date + '-' + index];
    const items = old
      ? old.rows.map((x) => ({ id: x.id, locked: x.locked }))
      : [];
    const stale = items.some((x) => !r.foods.some((f) => f.id === x.id));
    this.setData({
      foods: r.foods,
      hasFoods: r.foods.length > 0,
      showFoods: false,
      replaceId: '',
      foodLabels: r.foods.map((f) => f.name + ' · ' + f.state),
      choice: 0,
      items: stale ? [] : items,
      result: null,
      history: old || null,
      consumed: api.state()?.consumedMeals?.[date + '-' + index] || null,
      recommendations: [],
      error: stale
        ? '已保存搭配含当前不可推荐的食材，请重新选择。原记录已保留。'
        : ''
    });
    await this.calculate();
  },
  changeMeal(e) {
    api.run(this, async () => {
      this.setData({ index: Number(e.currentTarget.dataset.i), mode: 'meal' });
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
      await this.loadMeal();
    });
  },
  choose(e) {
    this.setData({ choice: Number(e.detail.value) });
  },
  openFoods(e) {
    const { id, type } = e.currentTarget.dataset;
    this.setData({
      showFoods: true,
      replaceId: id || '',
      choicesForMeal:
        type && type !== 'other'
          ? this.data.foods.filter((f) => f.primary === type)
          : this.data.foods
    });
  },
  closeFoods() {
    this.setData({ showFoods: false, replaceId: '' });
  },
  selectFood(e) {
    api.run(this, async () => {
      const id = e.currentTarget.dataset.id,
        old = this.data.replaceId;
      if (this.data.items.some((r) => r.id === id && id !== old))
        throw Error('本餐已选该食材');
      const items = old
        ? this.data.items.map((r) => (r.id === old ? { id, locked: null } : r))
        : this.data.items.concat({ id, locked: null });
      this.setData({ items, showFoods: false, replaceId: '' });
      await this.calculate();
    });
  },
  async calculate() {
    const d = this.data,
      r = await api.request('preview/meal', {
        profile: { ...this.profile, estimate: false },
        index: d.index,
        items: d.items
      });
    this.setData({
      result: r,
      sections: [
        ...foodTypes,
        ...(r.rows.some((x) => !foodTypes.some(([k]) => x.primary === k))
          ? [['other', '其他食材']]
          : [])
      ].map(([type, label]) => ({
        type,
        label,
        rows: r.rows.filter((x) =>
          type === 'other'
            ? !foodTypes.some(([k]) => x.primary === k)
            : x.primary === type
        )
      })),
      metrics: [
        ['能量', 'kcal', '千卡'],
        ['碳水', 'carb', 'g'],
        ['蛋白质', 'protein', 'g'],
        ['脂肪', 'fat', 'g']
      ].map(([name, k, unit]) => ({
        name,
        unit,
        target: r.target[k],
        actual: r.actual[k],
        delta: r.delta[k],
        deltaText:
          r.delta[k] === 0
            ? '已达目标'
            : r.delta[k] > 0
              ? '还差 ' + r.delta[k]
              : '超出 ' + -r.delta[k]
      }))
    });
  },
  add(e) {
    api.run(this, async () => {
      const id =
        e.currentTarget.dataset.id || this.data.foods[this.data.choice]?.id;
      if (!id || this.data.items.some((x) => x.id === id)) return;
      this.setData({ items: [...this.data.items, { id, locked: null }] });
      await this.calculate();
    });
  },
  grams(e) {
    const id = e.currentTarget.dataset.id;
    this.weights = this.weights || {};
    this.weights[id] = e.detail.value;
  },
  row(e) {
    api.run(this, async () => {
      const { id, op } = e.currentTarget.dataset;
      let items = this.data.items.map((i) => ({ ...i }));
      const r = items.find((i) => i.id === id);
      if (op === 'remove') items = items.filter((i) => i.id !== id);
      else if (op === 'unlock') r.locked = null;
      else {
        const v =
          this.weights?.[id] ??
          this.data.result.rows.find((x) => x.id === id).grams;
        if (v === '' || !Number.isFinite(Number(v)) || Number(v) < 0)
          throw Error('请输入有效克数');
        r.locked = Number(v);
      }
      this.setData({ items });
      await this.calculate();
    });
  },
  save() {
    api.run(this, async () => {
      await api.mutate('saveMeal', {
        index: this.data.index,
        date: this.data.date,
        items: this.data.items,
        version: this.data.result.version,
        generationId: this.generationId || undefined
      });
      await this.loadMeal();
      wx.showToast({ title: '搭配已保存' });
    });
  },
  suggest() {
    api.run(this, async () => {
      const r = await api.request('recommend', { index: this.data.index, requestId: 'meal-'+Date.now()+'-'+Math.random().toString(36).slice(2), parentId: this.generationId || undefined });
      this.generationId = r.generationId;
      this.setData({
        recommendations: (r.items || []).map((x) => ({
          ...x,
          name: this.data.foods.find((f) => f.id === x.id)?.name || ''
        })),
        error: r.reason ? r.reason + '，仍可手动选择食材。' : ''
      });
    });
  }
});
