const api = require('../../lib/service');
const nav = require('../../lib/navigation');
const display = require('../../lib/presentation');
Page({
  data: { error: '' },
  follow: nav.follow,
  openTraining() {
    if (this.data.session) nav.open('week', { date: this.data.date, mode: 'session' });
    else nav.open('pick', { from: 'plan', date: this.data.date });
  },
  async onShow() {
    nav.take('today');
    const date = api.localDate();
    this.draw(api.state(), date);
    if (api.credentials())
      try {
        this.draw(await api.refresh(), date);
      } catch (e) {
        this.setData({ error: e.message });
      }
  },
  draw(account, date) {
    const days = display.weekDays(date),
      profile = account?.profile;
    const scheduled = days.filter((day) => account?.sessions[day.date]);
    const week = account?.weeks[days[0].date];
    this.setData({
      date,
      days,
      caption:
        display.shortDate(date) + '，星期' + days.find((d) => d.active).weekday,
      session: account?.sessions[date] || null,
      hasWeek: !!week,
      gear: week?.gear?.join('、') || '徒手',
      planSummary: scheduled.length
        ? '已安排 ' +
          scheduled.length +
          ' 次训练 · ' +
          scheduled.map((d) => '周' + d.weekday).join('、')
        : '本周还没有安排训练',
      profile: profile || null,
      energy: profile
        ? String(profile.targets.kcal).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
        : '—',
      lunch: profile ? display.meals(profile)[1] : null,
      error: ''
    });
  }
});
