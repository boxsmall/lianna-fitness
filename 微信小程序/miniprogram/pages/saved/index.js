const { parts, exercises, section } = require('../../lib/catalog');
const storage = require('../../lib/storage');
Page({
  data: { selected: '全部', groups: [], total: 0 },
  onLoad() { this.limits = {}; },
  onShow() { this.refresh(); },
  refresh() {
    const snapshot = storage.read();
    const favorites = new Set(snapshot.favorites);
    const active = new Set(snapshot.active);
    const items = exercises.filter(move => !move.hidden && favorites.has(move.id));
    const buckets = new Map();
    for (const move of items) {
      if (!buckets.has(move.part)) buckets.set(move.part, []);
      buckets.get(move.part).push(move);
    }
    const available = parts.filter(name => buckets.has(name));
    const selected = available.includes(this.data.selected) ? this.data.selected : '全部';
    const visible = selected === '全部' ? available : [selected];
    this.setData({
      selected, tabs: ['全部'].concat(available), total: items.length,
      groups: visible.map(name => section(name, buckets.get(name), this.limits[name] || 24, active, favorites))
    });
  },
  select(event) {
    this.setData({ selected: event.currentTarget.dataset.name });
    this.refresh();
  },
  more(event) {
    const name = event.currentTarget.dataset.name;
    this.limits[name] = (this.limits[name] || 24) + 24;
    this.refresh();
  },
  pick() { wx.switchTab({ url: '/pages/pick/index' }); }
});
