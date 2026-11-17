const api = require('../../lib/service');
const mealNames = ['早餐', '午餐', '晚餐'];
const split = (v) =>
  String(v || '')
    .split(/[、,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
Page({
  data: {
    mealNames,
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
      age: '',
      activity: '久坐',
      generalAdult: false
    },
    sexes: ['女', '男'],
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
    this.setData({ index: Number(q.meal) || 0, date: api.localDate() });
    this.open();
  },
  async open() {
    try {
      const a = api.credentials() ? await api.refresh() : null,
        p = a?.profile;
      if (p) {
        this.setData({
          form: {
            ...this.data.form,
            ...p,
            ...p.targets,
            ratios: p.ratios.join(','),
            allergens: p.allergens.join('、'),
            avoid: p.avoid.join('、')
          },
          editing: false
        });
        this.profile = p;
        await this.loadMeal();
      }
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  input(e) {
    this.setData({ ['form.' + e.currentTarget.dataset.k]: e.detail.value });
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
    for (const k of ['carb', 'protein', 'fat'])
      if (f[k] !== '' && f[k] != null) targets[k] = Number(f[k]);
    return {
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
      if (
        !(await api.confirm(
          profile.estimate ? '确认估算结果' : '确认饮食目标',
          '每日 ' +
            profile.targets.kcal +
            ' 千卡，碳水 ' +
            profile.targets.carb +
            ' g、蛋白质 ' +
            profile.targets.protein +
            ' g、脂肪 ' +
            profile.targets.fat +
            ' g。'
        ))
      )
        return;
      if (!(await api.login())) return;
      const a = await api.mutate('profile', args);
      this.profile = a.profile;
      this.setData({ editing: false });
      await this.loadMeal();
    });
  },
  async loadMeal() {
    const { index, date } = this.data;
    const r = await api.request('foods', this.profile),
      old = api.state()?.meals[date + '-' + index];
    const items = old ? old.rows.map((x) => ({ id: x.id, locked: x.locked })) : [];
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
      recommendations: [],
      error: stale ? '已保存搭配含当前不可推荐的食材，请重新选择。原记录已保留。' : ''
    });
    await this.calculate();
  },
  changeMeal(e) {
    api.run(this, async () => {
      this.setData({ index: Number(e.currentTarget.dataset.i) });
      await this.loadMeal();
    });
  },
  choose(e) {
    this.setData({ choice: Number(e.detail.value) });
  },
  openFoods(e) {
    this.setData({ showFoods: true, replaceId: e.currentTarget.dataset.id || '' });
  },
  closeFoods() {
    this.setData({ showFoods: false, replaceId: '' });
  },
  selectFood(e) {
    api.run(this, async () => {
      const id = e.currentTarget.dataset.id,
        old = this.data.replaceId;
      if (this.data.items.some((r) => r.id === id && id !== old)) throw Error('本餐已选该食材');
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
        deltaText: r.delta[k] >= 0 ? '还差 ' + r.delta[k] : '超出 ' + -r.delta[k]
      }))
    });
  },
  add(e) {
    api.run(this, async () => {
      const id = e.currentTarget.dataset.id || this.data.foods[this.data.choice]?.id;
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
        const v = this.weights?.[id] ?? this.data.result.rows.find((x) => x.id === id).grams;
        if (v === '' || !Number.isFinite(Number(v)) || Number(v) < 0) throw Error('请输入有效克数');
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
        version: this.data.result.version
      });
      await this.loadMeal();
      wx.showToast({ title: '搭配已保存' });
    });
  },
  suggest() {
    api.run(this, async () => {
      const r = await api.request('recommend', { index: this.data.index });
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
