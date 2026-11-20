const { byId, media } = require('../../lib/catalog');
const api = require('../../lib/service');
const nav = require('../../lib/navigation');
Page({
  follow: nav.follow,
  demo(e) {
    nav.open('detail', { id: e.currentTarget.dataset.id });
  },
  screen(e) {
    this.setData({ mode: e.currentTarget.dataset.mode, error: '' });
  },
  data: { logged: false, tickets: [], error: '', nickname: '', avatar: '', consentIdentity: false },
  onShow() {
    const intent = nav.take('account');
    if (!intent && this.data.mode === 'identity') return;
    this.setData({ mode: intent?.mode || 'mine', error: '' });
    this.load();
  },
  async load() {
    this.setData({ logged: !!api.credentials(), needsLogin: false, history: [] });
    if (api.credentials()) {
      try {
        const a = await api.refresh();
        const meals = Object.entries(a.meals).map(([id, m]) => ({
          id,
          name: m.date + ' ' + ['早餐', '午餐', '晚餐', '加餐'][m.index]
        }));
        this.setData({
          nickname: a.identity?.nickname || '',
          avatar: api.asset(a.identity?.avatar),
          history: a.history
            .slice()
            .reverse()
            .map((s) => ({
              key: s.key,
              date: s.date,
              type: s.type,
              items: (s.items || [])
                .filter((i) => i.pattern !== '热身')
                .map((i) => ({
                  ...i,
                  done: (s.actual?.[i.key] || []).length,
                  cover: byId.has(i.id) ? media(byId.get(i.id), 'covers') : ''
                })),
              sets: Object.values(s.actual || {}).reduce(
                (n, v) => n + v.length,
                0
              )
            })),
          meals: [{ id: '', name: '不关联餐次' }, ...meals],
          mealRef: '',
          tickets: await api.request('tickets')
        });
      } catch (e) {
        this.setData({ error: e.status === 401 ? '登录已过期，请重新微信登录。' : e.message, needsLogin: e.status === 401 });
      }
    }
  },
  record(e) {
    nav.open('week', { date: e.currentTarget.dataset.date, mode: 'session' });
  },
  meal(e) {
    this.setData({
      mealRef: this.data.meals[Number(e.detail.value)]?.id || ''
    });
  },
  login() {
    api.run(this, async () => {
      if (!(await api.login())) return;
      await this.load();
      this.setData({ mode: api.state()?.identity ? 'mine' : 'identity' });
    });
  },
  editIdentity() {
    this.avatarData = '';
    const identity=api.state()?.identity;
    this.setData({mode:'identity',nickname:identity?.nickname || '',avatar:api.asset(identity?.avatar),consentIdentity:false,error:''});
  },
  nickname(e) { this.setData({nickname:e.detail.value,error:''}); },
  identityConsent(e) { this.setData({consentIdentity:e.detail.value.includes('agree'),error:''}); },
  chooseAvatar(e) {
    if (!e.detail.avatarUrl) return;
    api.run(this, async () => {
      const path=e.detail.avatarUrl;
      const file=await new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:path,encoding:'base64',success:resolve,fail:reject}));
      if (file.data.length > 350000) throw Error('头像超过256KB，请选择较小的图片');
      this.avatarData=file.data;
      this.setData({avatar:path,consentIdentity:false});
    });
  },
  saveIdentity() {
    api.run(this, async () => {
      const nickname=this.data.nickname.trim();
      if (!nickname) throw Error('请填写昵称');
      if (!this.data.consentIdentity) throw Error('请确认保存昵称和头像');
      if (!(await api.login())) return;
      await api.mutate('identity',{nickname,avatarData:this.avatarData || undefined,consent:true});
      this.avatarData='';
      await this.load();
      this.setData({mode:'mine',consentIdentity:false});
      wx.showToast({title:'资料已保存'});
    });
  },
  sync() {
    api.run(this, async () => {
      if (this.data.needsLogin && !(await api.login())) return;
      await api.sync();
      await this.load();
      wx.showToast({ title: '同步完成' });
    });
  },
  logout() {
    api.run(this, async () => {
      if (await api.confirm('退出账号', '退出后会清除本机账号资料。')) {
        await api.logout();
        wx.reLaunch({ url: '/pages/today/index' });
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
