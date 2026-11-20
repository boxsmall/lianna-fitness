const api = require('../../lib/service'),
  storage = require('../../lib/storage');
const { byId, media, equipmentCatalog } = require('../../lib/catalog');
const nav = require('../../lib/navigation');
const display = require('../../lib/presentation');
const T = require('../../lib/training'), workoutTypes = require('../../lib/workout-types');
const chooseOption = require('../../lib/choose-option');
const names = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
Page({
  follow: nav.follow,
  pauseOnExit() {
    const date = this.data.date, s = T.select(api.state()?.sessions, date, this.data.sessionKey);
    if (s?.status === '训练中' && s.timer?.running) api.mutate('pause', { date, sessionKey: s.key }).catch(()=>{});
  },
  onHide() { if (this.heartbeatTimer) clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; this.pauseOnExit(); },
  onUnload() { this.onHide(); },
  workoutType(e) { return api.run(this, async()=> { await this.commit('workoutType', { type: workoutTypes.keys[Number(e.detail.value)] }); }); },
  selectSession(e) { this.pauseOnExit(); this.setData({sessionKey:e.currentTarget.dataset.key,sessionName:null}); this.draw(); },
  newSession() { return api.run(this, async()=> {
    if (!(await api.login())) return;
    this.pauseOnExit();
    const a = await api.mutate('createSession', {date:this.data.date});
    this.setData({ sessionKey:a.lastCreatedSession, sessionName:null, mode:'session', preview:null }); this.draw();
  }); },
  sessionGoal(e) { return api.run(this,async()=>this.commit('sessionGoal',{goal:this.data.goals[Number(e.detail.value)]})); },
  energyField(e) { this.setData({ [e.currentTarget.dataset.k]: e.detail.value }); },
  nameField(e) {
    (this.nameDrafts ||= {})[this.data.sessionKey] = e.detail.value;
    this.setData({sessionName:e.detail.value});
  },
  toggleSessionSettings() {this.setData({sessionSettings:!this.data.sessionSettings});},
  closeSave() {this.setData({saveSheet:false});},
  saveTraining() {return api.run(this,async()=> {
    const name=(this.data.sessionName || '').trim();
    if(!name)throw Error('请填写训练名称');
    if(name!==(this.data.session.name || '今天的训练'))await this.commit('sessionName',{name});
    if(this.nameDrafts)delete this.nameDrafts[this.data.sessionKey];
    this.setData({saveSheet:true});
  });},
  startSaved() {this.setData({saveSheet:false});return this.train({currentTarget:{dataset:{action:'start'}}});},
  newToday() {this.pauseOnExit();this.setData({date:api.localDate(),sessionKey:'',start:api.monday(api.localDate())});return this.newSession();},
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
    this.setData({ date, sessionKey: e.currentTarget.dataset.key || '' });
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
    workoutTypes: workoutTypes.labels,
    sessionKey: '', energyAge: '', energyWeight: '',
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
      sessionKey: opts.sessionKey || '',
      gear: storage.read().owned
    });
  },
  async onShow() {
    if (typeof setInterval === 'function' && !this.heartbeatTimer) this.heartbeatTimer = setInterval(async()=> {
      const date = this.data.date, s = T.select(api.state()?.sessions, date, this.data.sessionKey);
      if (this.data.busy || this.beating || this.data.mode !== 'session' || !s?.timer?.running || s.status !== '训练中') return;
      this.beating = true;
      try { const a = await api.mutate('heartbeat', { date, sessionKey:s.key }); const next=T.select(a.sessions,date,s.key); if (this.data.date === date && this.data.sessionKey===s.key && next) this.setData({ session: next, timerSeconds: Math.round(next.timer.seconds) }); }
      catch(e) { this.setData({ error: '计时同步失败，请恢复网络后确认继续。' }); }
      finally { this.beating = false; }
    }, 30000);
    const intent = nav.take('week');
    if (intent) {
      const date = intent.date || (intent.add ? this.data.date : '') || api.localDate();
      if (intent.mode === 'create') { this.useOwnedGear = true; this.goalEdited = false; }
      this.setData({
        mode: intent.add ? 'session' : (intent.mode || 'week'),
        start: api.monday(date),
        date,
        sessionKey: intent.sessionKey || '',
        sessionName:null,
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
    if (intent?.add && T.onDate(api.state()?.sessions,this.data.date).length <= 1) await this.add();
  },
  draw() {
    this.getTabBar?.()?.setData({selected:'week',hidden:this.data.mode==='session'});
    const a = api.state();
    const { start, date, preview } = this.data;
    const sessions = preview ? preview.sessions : a?.sessions || {};
    const daySessions = T.onDate(sessions,date);
    const s = T.select(sessions,date,this.data.sessionKey) || daySessions[0];
    const rows = Array.from({ length: 7 }, (_, i) => {
      const d = api.shift(start, i),
        list = T.onDate(sessions,d), x = list[0];
      return {
        date: d,
        label: display.shortDate(d),
        dayNumber: Number(d.slice(-2)),
        weekday: names[i],
        type: list.length > 1 ? list.length+' 次训练' : x?.type || '休息',
        active: d === date,
        scheduled: !!x,
        status: list.length > 1 ? '多次训练' : x?.status || '',
        budget: list.reduce((sum,v)=>sum+v.budget,0),
        count: list.reduce((sum,v)=>sum+v.items.filter(m=>m.pattern!=='热身').length,0),
        summary:
          list.flatMap(v=>v.items)
            .filter((m) => m.pattern !== '热身')
            .map((m) => m.name)
            .join(' · ') || ''
      };
    });
    let mainOrdinal=0;
    const items = (s?.items || []).map((m) => {
      const actual = s.actual?.[m.key] || [];
      const previous = (a?.history || [])
        .slice()
        .reverse()
        .flatMap((t) => Object.values(t.actual || {}).flat())
        .find((v) => v.id === m.id);
      return {
        ...m,
        ordinal:m.pattern==='热身'?'':String(++mainOrdinal).padStart(2,'0'),
        part:byId.get(m.id)?.part || '',
        gear:(byId.get(m.id)?.gear || []).join(' / ') || '徒手',
        cover: byId.has(m.id) ? media(byId.get(m.id), 'covers') : '',
        done: actual.length,
        previous: previous
          ? previous.value +
            previous.unit +
            (previous.weight != null ? ' · ' + previous.weight + ' kg' : '')
          : '',
        actual: actual.map((g) => (g.extra ? '加练 ' : '') + g.value + g.unit).join('、')
      };
    });
    const time = s?.timing || {};
    const gear =
      this.data.mode === 'create'
        ? this.data.gear
        : s?.gear || preview?.gear || a?.weeks[start]?.gear || this.data.gear;
    const gearImage = equipmentCatalog[gear[0]]?.img;
    this.setData({
      gearLabel: gear.join('、') || '徒手',
      gearImage: gearImage ? '/assets/' + gearImage : '',
      rows,
      courses:rows.flatMap(row=>T.onDate(sessions,row.date).map(v=>({
        key:v.key,date:row.date,label:row.label,weekday:row.weekday,status:v.status,
        title:v.name || (v.type==='自行编排'?'今天的训练':v.type),
        minutes:Math.ceil((v.timing?.total||0)/60),count:v.items.filter(i=>i.pattern!=='热身').length,
        summary:v.items.filter(i=>i.pattern!=='热身').map(i=>i.name).join(' · ')
      }))),
      sessionName:(s?.status==='待训练' ? this.nameDrafts?.[s.key] : null) ?? (s?.key===this.data.sessionKey && this.data.sessionName!=null ? this.data.sessionName : s?.name || '今天的训练'),
      sessionSets:items.filter(m=>m.pattern!=='热身').reduce((n,m)=>n+m.sets,0),
      sessionCount:items.filter(m=>m.pattern!=='热身').length,
      sessionHasItems:items.length>0,
      sessionDateLabel:display.shortDate(date),
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
      sessionKey: s?.key || '',
      daySessions: daySessions.map((v,i)=>({key:v.key,label:'训练 '+(i+1)+' · '+(v.goal || a?.weeks[start]?.goal || '日常健身')+' · '+v.status})),
      workoutLabel: workoutTypes.types[s?.workoutType]?.label || '不估算 / 混合训练',
      energyAge: a?.profile?.age || this.data.energyAge || '',
      energyWeight: Object.values(a?.measurements || {}).sort((x,y)=>y.date.localeCompare(x.date))[0]?.weight || a?.profile?.weight || this.data.energyWeight || '',
      timerSeconds: Math.round(s?.timer?.seconds || 0),
      items,
      totalMinutes: Math.ceil((time.total || 0) / 60),
      overBudget: Math.max(0,Math.ceil((time.total || 0)/60) - (s?.budget || 0)),
      hasWeek: !!a?.weeks[start],
      manualDays: this.data.days > 4,
      addName: byId.get(this.data.addId)?.name || '',
      edit: !preview && s?.key===this.data.sessionKey && s?.items.some(i=>i.key===this.data.edit?.key) ? this.data.edit : null
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
          p.dates.map(day => [day, ...T.onDate(p.sessions,day).map(s=>[
            s.type, s.goal, s.items.map(i=>[i.id,i.sets,i.target,i.rest])
          ])])
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
    this.setData({ start, date: start, sessionKey:'', preview: null });
    this.draw();
  },
  select(e) {
    this.pauseOnExit();
    this.setData({ date: e.currentTarget.dataset.date, sessionKey:e.currentTarget.dataset.key || '', sessionName:null, mode: 'session' });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    this.draw();
  },
  trainingDate(e) {
    this.pauseOnExit();
    const date = e.detail.value;
    this.setData({ date, sessionKey:'', sessionName:null, start: api.monday(date), preview: null });
    this.draw();
  },
  demo(e) {
    wx.navigateTo({
      url: '/pages/detail/index?id=' + e.currentTarget.dataset.id
    });
  },
  async commit(action, data) {
    await api.mutate(action, { date: this.data.date, sessionKey:this.data.sessionKey || undefined, ...data });
    this.setData({edit:null});
    this.draw();
  },
  train(e) {
    return api.run(this, async () => {
      const action = e.currentTarget.dataset.action;
      if (
        action === 'finish' &&
        !(await api.confirm('结束训练', '按已实际记录的组数完成本节训练？'))
      )
        return;
      const body = {};
      if (action === 'start' && this.data.session?.workoutType) {
        body.age = Number(this.data.energyAge); body.weight = Number(this.data.energyWeight);
        if (body.age >= 65) {
          if (!(await api.confirm('确认估算局限','65岁及以上的身体组成与活动差异较大，活动消耗仅作粗略参考，不增加饮食额度。确认继续？'))) return;
          body.ageAcknowledged = true;
        }
      }
      await this.commit(action, body);
    });
  },
  move(e) {
    api.run(this, async () => {
      const to = e.detail.value,
        old = this.data.date,
        a = api.state();
      if (to === old) return;
      const others = T.onDate(a.sessions,to), other = others[0];
      const within = api.monday(to) === api.monday(old);
      let swapSessionKey;
      if (other && within) {
        const choices = others.filter(s=>s.status==='待训练');
        const pick = await chooseOption(['作为另一节独立训练',...choices.map(s=>'与目标日训练 '+(others.indexOf(s)+1)+' 交换')]);
        if (pick < 0) return;
        if (pick > 0) swapSessionKey=choices[pick-1].key;
      }
      const near = [api.shift(to, -1), api.shift(to, 1)].filter(
        (d) =>
          d !== old &&
          T.onDate(a.sessions,d).some(v=>v.items.some((i) =>
            this.data.session.items.some(
              (j) => byId.get(i.id)?.part === byId.get(j.id)?.part
            )
          ))
      );
      const w1 = api.monday(old),
        w2 = api.monday(to),
        count = (w) =>
          new Set(T.all(a.sessions).filter((s) => api.monday(s.date) === w).map(s=>s.date)).size;
      const totals =
        w1 !== w2 && !other
          ? '。调整后原周 ' +
            (count(w1) - (T.onDate(a.sessions,old).length===1 ? 1 : 0)) +
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
            (other && within ? (swapSessionKey ? '，与选定训练交换' : '，作为目标日另一节独立训练') : '') +
            (near.length ? '。相邻训练日有重复部位：' + near.join('、') : '') +
            '？'
        ))
      )
        return;
      const sessionKey = this.data.sessionKey;
      await api.mutate('move', { date: old, sessionKey, to, swap: !!swapSessionKey, swapSessionKey });
      this.setData({ start: api.monday(to), date: to, sessionKey, edit:null });
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
    const occurrence = this.data.session.items.filter(i=>i.id===m.id).findIndex(i=>i.key===m.key);
    const dates = Object.values(api.state().sessions)
      .filter(
        (x) =>
          x.date > this.data.date &&
          x.status === '待训练' &&
          x.type === this.data.session.type &&
          x.items.filter((i) => i.id === m.id).length > occurrence
      )
      .map((x) => x.date);
    return api.confirm('确认影响日期', [this.data.date, ...dates].join('、'));
  },
  apply(e) {
    api.run(this, async () => {
        const requested = e.currentTarget.dataset.action, action = requested === 'recordExtra' ? 'record' : requested,
        m = this.data.edit;
      const b = { key: m.key };
      if (action === 'edit') {
        Object.assign(b, {
          sets: Number(m.sets),
          target: Number(m.target),
          rest: Number(m.rest),
          future: m.future
        });
        if (!(await this.scope(b))) return;
      }
      if (action === 'record')
        Object.assign(b, {
          value: Number(m.value),
          weight: m.weight === '' ? null : Number(m.weight)
          , extra: requested === 'recordExtra'
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
        gear = this.data.session?.gear || api.state().weeks[this.data.start]?.gear || storage.read().owned;
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
        this.data.session?.gear || api.state().weeks[this.data.start]?.gear || storage.read().owned;
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
      if (this.data.session?.status === '已完成') {
        const a = await api.mutate('createSession', {date:this.data.date});
        this.setData({sessionKey:a.lastCreatedSession});
      }
      await this.commit('add', { id, confirmGear: !!missing.length });
      this.setData({ addId: '' });
      this.draw();
      wx.showToast({ title: '已加入当天训练', icon: 'none' });
    });
  },
  browse() {
    nav.open('pick', { from: 'plan', date: this.data.date, sessionKey:this.data.sessionKey || '' });
  }
});
