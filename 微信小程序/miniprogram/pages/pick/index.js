const { pickView } = require('../../lib/catalog');
const storage = require('../../lib/storage');
const api = require('../../lib/service');
const nav = require('../../lib/navigation');
const { byId } = require('../../lib/catalog');

Page({
  data: { selecting: false, selectedIds: [], selectedCount: 0, busy: false, error: '' },
  onLoad(options = {}) {
    this.limits = {};
    this.setData({ selecting: options.from === 'plan', date: options.date || api.localDate() });
    this.planGear = [...(api.state()?.weeks[api.monday(this.data.date)]?.gear || storage.read().owned)];
  },
  onShow() {
    this.refresh();
  },
  refresh() {
    const filters = getApp().globalData.filters;
    const prefs = storage.read();
    const view = pickView(filters, this.data.selecting ? { ...prefs, active: this.planGear } : prefs, this.limits);
    const existing = new Set((api.state()?.sessions[this.data.date]?.items || []).map(i => i.id));
    const selected = new Set(this.data.selectedIds);
    view.sections.forEach(group => group.rows.forEach(row => {
      row.selected = selected.has(row.id);
      row.already = existing.has(byId.get(row.id)?.sourceId || row.id);
    }));
    filters.category = view.category;
    this.setData({ ...view, selectedCount: selected.size });
  },
  toggleMove(e) {
    const id = e.detail.id, selected = new Set(this.data.selectedIds);
    if (!selected.delete(id)) selected.add(id);
    this.setData({ selectedIds: [...selected] });
    this.refresh();
  },
  confirmSelection() {
    return api.run(this, async () => {
      if (!this.data.selectedIds.length || !(await api.login())) return;
      const gear = api.state()?.weeks[api.monday(this.data.date)]?.gear || storage.read().owned;
      const missing = [...new Set(this.data.selectedIds.flatMap(id => {
        const m = byId.get(id);
        return m.gear.filter(g => !gear.includes(g) && !(m.alternatives?.[g] || []).some(x => gear.includes(x)));
      }))];
      if (missing.length && !(await api.confirm('所需器械不足', '缺少' + missing.join('、') + '，仍加入当天训练？'))) return;
      await api.mutate('addMany', { date: this.data.date, ids: this.data.selectedIds, confirmGear: !!missing.length });
      this.setData({ selectedIds: [], selectedCount: 0 });
      wx.showToast({ title: '已加入当天训练', icon: 'none' });
      nav.open('week', { date: this.data.date, mode: 'session' });
    });
  },
  muscle(e) {
    this.selectCategory({
      currentTarget: {
        dataset: { name: this.data.categories[Number(e.detail.value)] }
      }
    });
  },
  search(e) {
    getApp().globalData.filters.query = e.detail.value;
    this.limits = {};
    this.refresh();
  },
  all() {
    getApp().globalData.filters.parts = [];
    getApp().globalData.filters.category = '全部';
    this.refresh();
  },
  selectPart(event) {
    const name = event.currentTarget.dataset.name;
    const filters = getApp().globalData.filters;
    filters.parts = filters.parts.includes(name)
      ? filters.parts.filter((part) => part !== name)
      : filters.parts.concat(name);
    if (filters.category !== '热身') filters.category = '全部';
    this.limits = {};
    this.refresh();
  },
  selectCategory(event) {
    getApp().globalData.filters.category = event.currentTarget.dataset.name;
    this.limits = {};
    this.refresh();
  },
  reset() {
    if (!storage.saveGear(storage.read().owned, [])) return;
    getApp().globalData.filters = { parts: [], category: '全部' };
    this.limits = {};
    this.refresh();
  },
  equipment() {
    wx.navigateTo({
      url: '/pages/equipment/index' + (this.data.selecting ? '?from=plan&gear=' + encodeURIComponent(JSON.stringify(this.planGear)) : ''),
      events: {
        applied: (gear) => {
          if (this.data.selecting) this.planGear = gear;
          this.limits = {};
        }
      }
    });
  },
  more(event) {
    const name = event.currentTarget.dataset.name;
    this.limits[name] =
      (this.limits[name] || (this.data.category === '全部' ? 6 : 24)) + 24;
    this.refresh();
  }
});
