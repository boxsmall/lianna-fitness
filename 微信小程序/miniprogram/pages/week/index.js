const api = require('../../lib/service'),
  storage = require('../../lib/storage');
const { byId, media, equipmentCatalog } = require('../../lib/catalog');
const nav = require('../../lib/navigation');
const display = require('../../lib/presentation');
const names = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
Page({
  follow: nav.follow,
  pauseOnExit() {
    const date = this.data.date, s = api.state()?.sessions?.[date];
    if (s?.status === '训练中' && s.timer?.running) api.mutate('pause', { date }).catch(()=>{});
  },
  onHide() { if (this.heartbeatTimer) clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; this.pauseOnExit(); },
  onUnload() { this.onHide(); },
  workoutType(e) { return api.run(this, async()=> { await this.commit('workoutType', { type: ['', 'resistance', 'bodyweight'][Number(e.detail.value)] }); }); },
  mode(e) {
    this.pauseOnExit();
    if (e.currentTarget.dataset.mode === 'create') {
      this.useOwnedGear = true;
      this.goalEdited = false;
      const goal = api.state()?.stageGoal;
      if (goal) this.setData({ goal: goal === '维持' ? '日常健身' : goal });
      this.setData({ gear: [...storage.read().owned], preview: null });
    }
    this.setData({
      mode: e.currentTarget.dataset.mode,
      error: '',
      edit: null,
      moveDate: null
    });
    this.draw();
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  option(e) {
    if (e.currentTarget.dataset.k === 'goal') this.goalEdited = true;
    this.setData({
      [e.currentTarget.dataset.k]: e.currentTarget.dataset.v,
      preview: null
    });
    this.draw();
  },
  emptyAction() {
    this.browse();
  },
  replaceItem(e) {
    this.editor(e);
    this.replacements();
  },
  toggleAdvanced() {
    this.setData({ advanced: !this.data.advanced });
  },
  dateDialog(e) {
    const date = e.currentTarget.dataset.date;
    this.setData({ date });
    this.draw();
    this.setData({ moveDate: date, destination: date });
  },
  destination(e) {
    this.setData({ destination: e.detail.value });
  },
  closeDate() {
    this.setData({ moveDate: null });
  },
  confirmDate() {
    this.move({ detail: { value: this.data.destination } });
    this.closeDate();
  },
  data: {
    workoutTypes: ['不估算 / 混合训练', '常规多动作抗阻训练', '常规自重训练'],
    mode: 'week',
    advanced: false,
    goals: ['增肌', '减脂', '日常健身'],
    daysList: [1, 2, 3, 4, 5, 6, 7],
    minutesList: [15, 20, 30, 45, 60, 90],
    goal: '日常健身',
    days: 3,
    minutes: 30,
    gear: [],
    weekdays: [],
    dayOptions: names,
    experience: '基础',
    experiences: ['基础', '有经验'],
    useFour: false,
    blank: false,
    start: '',
    date: '',
    preview: null,
    session: null,
    rows: [],
    edit: null,
    addId: '',
    error: '',
    busy: false
  },
  onLoad(opts) {
    this.useOwnedGear = true;
    this.setData({
      start: api.monday(opts.date || api.localDate()),
      date: opts.date || api.localDate(),
      addId: opts.add || '',
      gear: storage.read().owned
    });
  },
  async onShow() {
    if (typeof setInterval === 'function' && !this.heartbeatTimer) this.heartbeatTimer = setInterval(async()=> {
      const date = this.data.date, s = api.state()?.sessions?.[date];
      if (this.data.busy || this.beating || this.data.mode !== 'session' || !s?.timer?.running || s.status !== '训练中') return;
      this.beating = true;
      try { const a = await api.mutate('heartbeat', { date }); if (this.data.date === date) this.setData({ session: a.sessions[date], timerSeconds: Math.round(a.sessions[date].timer.seconds) }); }
      catch(e) { this.setData({ error: '计时同步失败，请恢复网络后确认继续。' }); }
      finally { this.beating = false; }
    }, 30000);
    const intent = nav.take('week');
    if (intent) {
      const date = intent.date || (intent.add ? this.data.date : '') || api.localDate();
      if (intent.mode === 'create') this.useOwnedGear = true;
      this.setData({
        mode: intent.add ? 'session' : (intent.mode || 'week'),
        start: api.monday(date),
        date,
        addId: intent.add || '',
        error: '',
        edit: null,
        preview: null,
        moveDate: null
      });
    }
    this.draw();
    if (api.credentials())
      try {
        await api.sync();
        if (this.useOwnedGear) this.setData({ gear: [...storage.read().owned] });
        this.draw();
      } catch (e) {
        this.setData({ error: e.message });
      }
    if (this.useOwnedGear) this.setData({ gear: [...storage.read().owned] });
    if (api.state()?.stageGoal && !this.goalEdited) this.setData({ goal: api.state().stageGoal === '维持' ? '日常健身' : api.state().stageGoal });
    this.draw();
    if (intent?.add) await this.add();
  },
  draw() {
    const a = api.state();
    const { start, date, preview } = this.data;
    const sessions = preview ? preview.sessions : a?.sessions || {};
    const s = sessions[date];
    const rows = Array.from({ length: 7 }, (_, i) => {
      const d = api.shift(start, i),
        x = sessions[d];
      return {
        date: d,
        label: display.shortDate(d),
        weekday: names[i],
        type: x?.type || '休息',
        active: d === date,
        scheduled: !!x,
        status: x?.status || '',
        budget: x?.budget || 0,
        count: x?.items.filter((m) => m.pattern !== '热身').length || 0,
        summary:
          x?.items
            .filter((m) => m.pattern !== '热身')
            .map((m) => m.name)
            .join(' · ') || ''
      };
    });
    const items = (s?.items || []).map((m) => {
      const actual = s.actual?.[m.key] || [];
      const previous = (a?.history || [])
        .slice()
        .reverse()
        .flatMap((t) => Object.values(t.actual || {}).flat())
        .find((v) => v.id === m.id);
      return {
        ...m,
        cover: byId.has(m.id) ? media(byId.get(m.id), 'covers') : '',
        done: actual.length,
        previous: previous
          ? previous.value +
            previous.unit +
            (previous.weight != null ? ' · ' + previous.weight + ' kg' : '')
          : '',
        actual: actual.map((g) => g.value + g.unit).join('、')
      };
    });
    const time = s?.timing || {};
    const gear =
      this.data.mode === 'create'
        ? this.data.gear
        : preview?.gear || a?.weeks[start]?.gear || this.data.gear;
    const gearImage = equipmentCatalog[gear[0]]?.img;
    this.setData({
      gearLabel: gear.join('、') || '徒手',
      gearImage: gearImage ? '/assets/' + gearImage : '',
      rows,
      scheduled: rows.filter((r) => r.scheduled),
      restDays: rows
        .filter((r) => !r.scheduled)
        .map((r) => r.weekday)
        .join('、'),
      weekLabel:
        display.shortDate(start) + ' — ' + display.shortDate(rows[6].date),
      meta: preview || a?.weeks[start] || null,
      warm: items.filter((m) => m.pattern === '热身'),
      mainItems: items.filter((m) => m.pattern !== '热身'),
      session: s || null,
      timerSeconds: Math.round(s?.timer?.seconds || 0),
      items,
      totalMinutes: Math.ceil((time.total || 0) / 60),
      hasWeek: !!a?.weeks[start],
      manualDays: this.data.days > 4,
      addName: byId.get(this.data.addId)?.name || '',
      edit: null
    });
  },
  field(e) {
    const k = e.currentTarget.dataset.k,
      v = e.detail.value;
    this.setData({ [k]: v, preview: null });
    this.draw();
  },
  choose(e) {
    const { k, list } = e.currentTarget.dataset;
    this.setData({
      [k]: this.data[list][Number(e.detail.value)],
      preview: null
    });
    this.draw();
  },
  weekdays(e) {
    this.setData({ weekdays: e.detail.value.map(Number), preview: null });
    this.draw();
  },
  gear() {
    wx.navigateTo({
      url:
        '/pages/equipment/index?from=plan&gear=' +
        encodeURIComponent(JSON.stringify(this.data.gear)),
      events: {
        applied: (gear) => {
          this.useOwnedGear = false;
          this.setData({ gear, preview: null });
          this.draw();
        }
      }
    });
  },
  bodyweight() {
    this.useOwnedGear = false;
    this.setData({ gear: [], preview: null });
    this.draw();
  },
  input() {
    const d = this.data;
    return {
      start: d.start,
      goal: d.goal,
      days: d.days,
      minutes: d.minutes,
      gear: d.gear,
      experience: d.experience,
      weekdays: d.weekdays,
      useFour: d.useFour,
      blank: d.blank,
      anchor: Object.keys(api.state()?.weeks || {}).sort()[0] || d.start,
      favorites: storage.read().favorites
    };
  },
  generate() {
    api.run(this, async () => {
      const preview = await api.request('preview/plan', this.input());
      this.setData({
        mode: 'week',
        preview,
        date: preview.dates.find((d) => preview.sessions[d]) || preview.start
      });
      this.draw();
    });
  },
  save() {
    api.run(this, async () => {
      if (!(await api.login())) return;
      const input = this.input(),
        p = await api.request('preview/plan', input);
      const describe = (p) =>
        JSON.stringify(
          p.dates.map((day) => {
            const s = p.sessions[day];
            return s
              ? [
                  day,
                  s.type,
                  s.items.map((i) => [i.id, i.sets, i.target, i.rest])
                ]
              : [day];
          })
        );
      if (!this.data.preview || describe(this.data.preview) !== describe(p)) {
        this.setData({ preview: p });
        this.draw();
        throw Error('登录同步或内容发布后安排已变化，请查看新预览再确认。');
      }
      const msg = (p.replaced || [])
        .map((x) => x.date + (x.manual ? '（手动调整）' : ''))
        .join('、');
      if (
        !(await api.confirm(
          '保存本周计划',
          msg
            ? '这些待训练日期将被替换：' + msg
            : '保存从 ' + p.start + ' 开始的七天安排？'
        ))
      )
        return;
      await api.mutate('savePlan', { input, version: p.version });
      this.setData({ preview: null });
      this.draw();
    });
  },
  cancel() {
    this.setData({ preview: null });
    this.draw();
  },
  week(e) {
    this.pauseOnExit();
    const start = api.shift(this.data.start, Number(e.currentTarget.dataset.n));
    this.setData({ start, date: start, preview: null });
    this.draw();
  },
  select(e) {
    this.pauseOnExit();
    this.setData({ date: e.currentTarget.dataset.date, mode: 'session' });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    this.draw();
  },
  trainingDate(e) {
    this.pauseOnExit();
    const date = e.detail.value;
    this.setData({ date, start: api.monday(date), preview: null });
    this.draw();
  },
  demo(e) {
    wx.navigateTo({
      url: '/pages/detail/index?id=' + e.currentTarget.dataset.id
    });
  },
  async commit(action, data) {
    await api.mutate(action, { date: this.data.date, ...data });
    this.draw();
  },
  train(e) {
    api.run(this, async () => {
      const action = e.currentTarget.dataset.action;
      if (
        action === 'finish' &&
        !(await api.confirm('结束训练', '按已实际记录的组数完成本节训练？'))
      )
        return;
      await this.commit(action, {});
    });
  },
  move(e) {
    api.run(this, async () => {
      const to = e.detail.value,
        old = this.data.date,
        a = api.state();
      if (to === old) return;
      const other = a.sessions[to];
      const within = api.monday(to) === api.monday(old);
      const near = [api.shift(to, -1), api.shift(to, 1)].filter(
        (d) =>
          d !== old &&
          a.sessions[d]?.items.some((i) =>
            this.data.session.items.some(
              (j) => byId.get(i.id)?.part === byId.get(j.id)?.part
            )
          )
      );
      const w1 = api.monday(old),
        w2 = api.monday(to),
        count = (w) =>
          Object.keys(a.sessions).filter((d) => api.monday(d) === w).length;
      const totals =
        w1 !== w2 && !other
          ? '。调整后原周 ' +
            (count(w1) - 1) +
            ' 天，下周 ' +
            (count(w2) + 1) +
            ' 天'
          : '';
      if (
        !(await api.confirm(
          '调整日期',
          old +
            ' → ' +
            to +
            totals +
            (other && within ? '，与目标日交换' : '') +
            (near.length ? '。相邻训练日有重复部位：' + near.join('、') : '') +
            '？'
        ))
      )
        return;
      await this.commit('move', { to, swap: !!other && within });
      this.setData({ start: api.monday(to), date: to });
      this.draw();
    });
  },
  editor(e) {
    const m = this.data.items.find(
      (x) => x.key === e.currentTarget.dataset.key
    );
    this.setData({
      edit: { ...m, value: m.target, weight: '', future: false },
      candidates: []
    });
  },
  editField(e) {
    this.setData({ ['edit.' + e.currentTarget.dataset.k]: e.detail.value });
  },
  closeEdit() {
    this.setData({ edit: null });
  },
  async scope(b) {
    const m = this.data.edit;
    if (!m.future) return true;
    const dates = Object.values(api.state().sessions)
      .filter(
        (x) =>
          x.date > this.data.date &&
          x.status === '待训练' &&
          x.type === this.data.session.type &&
          x.items.some((i) => i.id === m.id)
      )
      .map((x) => x.date);
    return api.confirm('确认影响日期', [this.data.date, ...dates].join('、'));
  },
  apply(e) {
    api.run(this, async () => {
      const action = e.currentTarget.dataset.action,
        m = this.data.edit;
      const b = { key: m.key };
      if (action === 'edit') {
        Object.assign(b, {
          sets: Number(m.sets),
          target: Number(m.target),
          future: m.future
        });
        if (!(await this.scope(b))) return;
      }
      if (action === 'record')
        Object.assign(b, {
          value: Number(m.value),
          weight: m.weight === '' ? null : Number(m.weight)
        });
      if (action === 'remove' && !(await api.confirm('移除动作', m.name)))
        return;
      if (action === 'reorder') {
        const i = this.data.items.findIndex((x) => x.key === m.key);
        b.index = i - 1;
      }
      if (action === 'replace') {
        Object.assign(b, { id: e.currentTarget.dataset.id, future: m.future });
        if (!(await this.scope(b))) return;
      }
      await this.commit(action, b);
    });
  },
  replacements() {
    api.run(this, async () => {
      const m = this.data.edit,
        gear = api.state().weeks[this.data.start]?.gear || storage.read().owned;
      const candidates = await api.request('replacements', { id: m.id, gear });
      this.setData({ candidates });
      if (!candidates.length)
        this.setData({ error: '没有器械匹配的同模式替代动作。' });
    });
  },
  add() {
    return api.run(this, async () => {
      if (!(await api.login())) return;
      const id = this.data.addId,
        m = byId.get(id);
      if (!m) return;
      const gear =
        api.state().weeks[this.data.start]?.gear || storage.read().owned;
      const missing = m.gear.filter(
        (g) =>
          !gear.includes(g) &&
          !(m.alternatives?.[g] || []).some((v) => gear.includes(v))
      );
      if (
        missing.length &&
        !(await api.confirm(
          '所需器械不足',
          '缺少' + missing.join('、') + '。仍加入这天的计划？'
        ))
      )
        return;
      await this.commit('add', { id, confirmGear: !!missing.length });
      this.setData({ addId: '' });
      this.draw();
      wx.showToast({ title: '已加入当天训练', icon: 'none' });
    });
  },
  browse() {
    nav.open('pick', { from: 'plan', date: this.data.date });
  }
});
