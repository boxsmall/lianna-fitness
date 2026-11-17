const { gearList, equipmentCatalog, groups, availableGear } = require('../../lib/catalog');
const storage = require('../../lib/storage');
const inTraining = availableGear([], '全部');
const choices = ['全部分类'].concat(groups);

Page({
  data: { mode: 'active', query: '', choices, groupIndex: 0, groups: [] },
  onLoad() {
    const saved = storage.read();
    this.active = new Set(saved.active);
    this.owned = new Set(saved.owned);
    const filters = getApp().globalData.filters;
    this.allowed = availableGear(filters.parts, filters.category);
    this.refresh();
  },
  refresh() {
    const inventory = this.data.mode === 'owned';
    const selected = inventory ? this.owned : this.active;
    const query = this.data.query.trim().toLowerCase();
    const groupName = choices[this.data.groupIndex];
    const byGroup = new Map();
    for (const name of gearList) {
      const item = equipmentCatalog[name];
      if (this.data.groupIndex && item.group !== groupName) continue;
      if (!(name + ' ' + item.aliases).toLowerCase().includes(query)) continue;
      const checked = selected.has(name);
      const disabled = !inventory && !checked && !this.allowed.has(name);
      if (!byGroup.has(item.group)) byGroup.set(item.group, []);
      byGroup.get(item.group).push({
        name, checked, disabled, img: '/assets/' + item.img,
        note: !inTraining.has(name) ? '原库暂无正式动作' : disabled ? '当前条件不匹配' : ''
      });
    }
    this.setData({
      groups: groups.filter(name => byGroup.has(name)).map(name => ({ name, items: byGroup.get(name) })),
      selectedCount: selected.size, canClear: !inventory && this.active.size > 0
    });
  },
  mode(event) {
    this.setData({ mode: event.currentTarget.dataset.mode });
    this.refresh();
  },
  search(event) {
    this.setData({ query: event.detail.value });
    this.refresh();
  },
  group(event) {
    this.setData({ groupIndex: Number(event.detail.value) });
    this.refresh();
  },
  toggle(event) {
    const name = event.currentTarget.dataset.name;
    if (this.data.mode === 'owned') {
      if (this.owned.delete(name)) this.active.delete(name);
      else {
        this.owned.add(name);
        if (this.allowed.has(name)) this.active.add(name);
      }
    } else if (!this.active.delete(name) && this.allowed.has(name)) {
      this.active.add(name);
      this.owned.add(name);
    }
    this.refresh();
  },
  clear() { this.active.clear(); this.refresh(); },
  save() {
    if (!storage.saveGear(Array.from(this.owned), Array.from(this.active))) return;
    const channel = this.getOpenerEventChannel();
    if (channel && channel.emit) channel.emit('applied');
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/pick/index' }) });
  }
});
