const api = require('../../lib/service');
Page({
  data: { logged: false, tickets: [], error: '' },
  onShow() {
    this.load();
  },
  async load() {
    this.setData({ logged: !!api.credentials(), history:[] });
    if (api.credentials()) {
      try {
        const a = await api.refresh();
        const meals = Object.entries(a.meals).map(([id, m]) => ({
          id,
          name: m.date + ' ' + ['早餐', '午餐', '晚餐'][m.index]
        }));
        this.setData({
          history: a.history.slice().reverse().map(s=>({key:s.key,date:s.date,type:s.type,sets:Object.values(s.actual||{}).reduce((n,v)=>n+v.length,0)})),
          meals: [{ id: '', name: '不关联餐次' }, ...meals],
          mealRef: '',
          tickets: await api.request('tickets')
        });
      } catch (e) {
        this.setData({ error: e.message });
      }
    }
  },
  record(e){wx.navigateTo({url:'/pages/week/index?date='+e.currentTarget.dataset.date});},
  meal(e) {
    this.setData({ mealRef: this.data.meals[Number(e.detail.value)]?.id || '' });
  },
  login() {
    api.run(this, async () => {
      await api.login();
      await this.load();
    });
  },
  sync() {
    api.run(this, async () => {
      await api.sync();
      await this.load();
      wx.showToast({ title: '同步完成' });
    });
  },
  logout() {
    api.run(this, async () => {
      if (await api.confirm('退出账号', '退出后会清除本机账号资料。')) {
        await api.logout();
        wx.reLaunch({url:'/pages/today/index'});
      }
    });
  },
  text(e) {
    this.detail = e.detail.value;
  },
  consent(e) {
    this.allowed = e.detail.value;
  },
  submit(e) {
    api.run(this, async () => {
      const kind = e.currentTarget.dataset.kind;
      if (
        kind === '注销' &&
        !(await api.confirm(
          '申请注销',
          '工单涉及账号、收藏、器械、训练计划、实绩、饮食资料及各餐搭配。提交后可在此查看处理状态。'
        ))
      )
        return;
      await api.request('ticket', {
        kind,
        detail: this.detail || kind,
        consent: !!this.allowed,
        mealRef: this.data.mealRef
      });
      await this.load();
    });
  }
});
