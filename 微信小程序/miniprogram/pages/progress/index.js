const api = require('../../lib/service');
const nav = require('../../lib/navigation');
Page({
  data: { date: '', today: '', weight: '', waist: '', adherence: '未记录', wellbeing: '正常', waterChange: false,
    adherenceOptions: ['基本按计划', '偏多', '偏少', '未记录'], wellbeingOptions: ['正常', '明显饥饿或疲劳', '训练表现下降'], result: null, error: '', busy: false },
  follow: nav.follow,
  onShow() { this.setData({ date: api.localDate(), today: api.localDate() }); return api.run(this, async()=> { if (!(await api.login())) return; await this.reload(); }); },
  async reload() {
    const a = await api.refresh(), result = await api.request('energy/progress');
    this.setData({ result, profile: a.profile || null, goal: a.stageGoal || a.profile?.goal || '未设置' });
    this.readDate();
  },
  readDate() {
    const a = api.state(), record = a?.measurements?.[this.data.date], feedback = a?.energyFeedback?.[this.data.date];
    this.setData({ weight: record?.weight || '', waist: record?.waist || '', adherence: feedback?.adherence || '未记录', wellbeing: feedback?.wellbeing || '正常', waterChange: feedback?.waterChange || false });
  },
  field(e) { this.setData({ [e.currentTarget.dataset.k]: e.detail.value }); if (e.currentTarget.dataset.k === 'date') this.readDate(); },
  pick(e) { const { k, list } = e.currentTarget.dataset; this.setData({ [k]: this.data[list][Number(e.detail.value)] }); },
  saveWeight() { return api.run(this, async()=> {
    await api.mutate('measurement', { date: this.data.date, weight: Number(this.data.weight), waist: this.data.waist === '' ? null : Number(this.data.waist) });
    await this.reload(); wx.showToast({ title: '体重已记录' });
  }); },
  saveFeedback() { return api.run(this, async()=> {
    const { date, adherence, wellbeing, waterChange } = this.data;
    await api.mutate('energyFeedback', { date, adherence, wellbeing, waterChange });
    await this.reload(); wx.showToast({ title: '反馈已保存' });
  }); },
  accept() { return api.run(this, async()=> {
    const r = this.data.result?.recommendation;
    if (!r || !(await api.confirm('确认饮食调整', r.effectiveFrom + ' 起每日 ' + r.targets.kcal + ' 千卡，三类营养一起更新。今天的目标保持不变。'))) return;
    await api.mutate('acceptEnergy', { id: r.id }); await this.reload();
  }); },
  cancel() { return api.run(this, async()=> {
    if (!(await api.confirm('取消待生效调整', '继续使用当前饮食目标？'))) return;
    await api.mutate('cancelEnergy', {}); await this.reload();
  }); }
});
