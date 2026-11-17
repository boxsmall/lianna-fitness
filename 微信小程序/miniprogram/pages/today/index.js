const api = require('../../lib/service');
Page({
  data: { date: '', session: null, profile: null, meals: [], error: '' },
  async onShow() {
    const date = api.localDate();
    this.setData({ date });
    const cached = api.state();
    this.draw(cached, date);
    if (api.credentials()) {
      try {
        this.draw(await api.refresh(), date);
      } catch (e) {
        this.setData({ error: e.message });
      }
    }
  },
  draw(a, date) {
    const profile = a?.profile;
    this.setData({
      session: a?.sessions[date] || null,
      profile: profile || null,
      hasWeek: !!a?.weeks[api.monday(date)],
      meals: ['早餐', '午餐', '晚餐'].map((name, i) => {
        const m = { name, index: i };
        if (profile)
          for (const k of ['kcal', 'carb', 'protein', 'fat']) {
            const total = profile.targets[k],
              r = profile.ratios,
              breakfast = Math.round((total * r[0]) / 100),
              lunch = Math.round((total * r[1]) / 100);
            m[k] = [breakfast, lunch, Math.round(total) - breakfast - lunch][i];
          }
        return m;
      })
    });
  },
  week() {
    wx.navigateTo({ url: '/pages/week/index' });
  },
  diet(e) {
    wx.navigateTo({ url: '/pages/diet/index?meal=' + (e.currentTarget.dataset.index || 0) });
  },
  account() {
    wx.navigateTo({ url: '/pages/account/index' });
  },
  pick() {
    wx.switchTab({ url: '/pages/pick/index' });
  }
});
