const api = require('../../lib/service');
const nav = require('../../lib/navigation');
const display = require('../../lib/presentation');
const T = require('../../lib/training');
const {byId,media} = require('../../lib/catalog');
Page({
  data: { error: '' },
  follow: nav.follow,
  openTraining() {
    if (this.data.session) nav.open('week', { date: this.data.date, sessionKey: this.data.session.key, mode: 'session' });
    else this.newTraining();
  },
  newTraining() {
    return api.run(this,async()=> {
      if(!(await api.login()))return;
      const a=await api.mutate('createSession',{date:this.data.date});
      nav.open('week',{date:this.data.date,sessionKey:a.lastCreatedSession,mode:'session'});
    });
  },
  async onShow() {
    this.getTabBar?.()?.setData({selected:'today',hidden:false});
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
    const scheduled = days.filter((day) => T.onDate(account?.sessions,day.date).length);
    const daySessions = T.onDate(account?.sessions,date);
    const week = account?.weeks[days[0].date];
    const session = daySessions.find(s=>s.status!=='已完成') || daySessions[0] || null;
    this.setData({
      date,
      days:days.map(d=>({...d,scheduled:T.onDate(account?.sessions,d.date).length>0})),
      caption:
        display.shortDate(date) + '，星期' + days.find((d) => d.active).weekday,
      session,
      heroCover: byId.has(session?.items?.[0]?.id) ? media(byId.get(session.items[0].id),'covers') : '/assets/0293.webp',
      sessionMinutes: Math.ceil((session?.timing?.total || 0)/60),
      sessionItemCount: session?.items?.length || 0,
      sessionCount: daySessions.length,
      hasWeek: !!week,
      gear: (session?.gear || week?.gear || account?.prefs?.owned || []).join('、') || '徒手',
      planSummary: scheduled.length
        ? '已安排 ' +
          T.all(account?.sessions).filter(s=>s.date>=days[0].date && s.date<=days[6].date).length +
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
