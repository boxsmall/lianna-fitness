const { pickView } = require('../../lib/catalog');
const storage = require('../../lib/storage');

Page({
  data: {},
  onLoad() { this.limits = {}; },
  onShow() { this.refresh(); },
  refresh() {
    const filters = getApp().globalData.filters;
    const view = pickView(filters, storage.read(), this.limits);
    filters.category = view.category;
    this.setData(view);
  },
  selectPart(event) {
    const name = event.currentTarget.dataset.name;
    const filters = getApp().globalData.filters;
    filters.parts = filters.parts.includes(name) ? filters.parts.filter(part => part !== name) : filters.parts.concat(name);
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
    wx.navigateTo({ url: '/pages/equipment/index', events: { applied: () => { this.limits = {}; } } });
  },
  more(event) {
    const name = event.currentTarget.dataset.name;
    this.limits[name] = (this.limits[name] || (this.data.category === '全部' ? 6 : 24)) + 24;
    this.refresh();
  }
});
