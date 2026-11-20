// 发布时填写微信后台登记的业务 HTTPS 地址，也可通过 extConfig.liannaApi 提供。
const apiOrigin = 'https://admin.yijiandot.com.cn';
const sessionKey = 'lianna.session.v2';
const storage = require('./storage');
let account = null;
let mutationQueue = Promise.resolve();
function credentials() {
  return wx.getStorageSync(sessionKey) || null;
}
function base() {
  const configured = wx.getExtConfigSync?.()?.liannaApi || apiOrigin;
  if (configured && /^https:\/\//.test(configured)) return configured.replace(/\/$/, '');
  const platform = wx.getDeviceInfo ? wx.getDeviceInfo().platform : wx.getSystemInfoSync().platform;
  return platform === 'devtools' ? 'http://127.0.0.1:8786' : '';
}
function request(route, data = {}, token = credentials()?.token) {
  const origin = base();
  if (!origin) return Promise.reject(new Error('业务服务尚未配置，请联系管理员设置 HTTPS 地址'));
  return new Promise((resolve, reject) =>
    wx.request({
      url: origin + '/api/' + route,
      method: 'POST',
      data,
      timeout: 16000,
      header: { 'Content-Type': 'application/json', Authorization: token ? 'Bearer ' + token : '' },
      success: (r) => {
        if (r.statusCode === 200) resolve(r.data);
        else
          reject(
            Object.assign(new Error(r.data?.error || '服务请求失败'), { status: r.statusCode })
          );
      },
      fail: () => reject(new Error('未能连接业务服务，请检查网络后重试'))
    })
  );
}
function alert(message) {
  return new Promise((resolve) =>
    wx.showModal({ title: '练哪', content: message, showCancel: false, complete: resolve })
  );
}
function confirm(title, content) {
  return new Promise((resolve) =>
    wx.showModal({ title, content, success: (r) => resolve(r.confirm), fail: () => resolve(false) })
  );
}
async function refresh() {
  const s = credentials();
  if (!s) return null;
  const value = await request('state', {}, s.token);
  if (credentials()?.token === s.token) account = value;
  return value;
}
async function login() {
  const previous = credentials();
  if (previous) {
    try {
      await refresh();
      return await sync();
    } catch (e) {
      if (e.status !== 401) throw e;
    }
  }
  if (!(await confirm('微信登录', '同意使用微信身份登录练哪，用于同步收藏、训练和饮食记录。昵称和头像由你另行选择保存，不会自动读取。')))
    return null;
  const { code } = await new Promise((resolve, reject) =>
    wx.login({ success: resolve, fail: reject })
  );
  const result = await request('login', { code }, '');
  const sameAccount = previous?.accountId === result.accountId;
  const guest = previous && !sameAccount
    ? { owned: [], active: [], favorites: [] }
    : storage.read();
  const base = sameAccount ? storage.savedBase() : null;
  if (previous && !sameAccount) clearLocal();
  wx.setStorageSync(sessionKey, { token: result.token, accountId: result.accountId });
  account = result.state;
  try {
    await mutate('sync', { ...guest, merge: !sameAccount, base });
    return account;
  } catch (e) {
    throw new Error('登录成功，首次同步未完成。请在「我的」重试。' + e.message);
  }
}
function pendingKey() {
  return 'lianna.pending.' + credentials()?.accountId;
}
async function sendPending() {
  const s = credentials();
  if (!s) return null;
  const k = pendingKey(),
    cmd = wx.getStorageSync(k);
  if (!cmd) return account;
  try {
    const next = await request('change', cmd, s.token);
    if (credentials()?.token !== s.token) return null;
    wx.removeStorageSync(k);
    account = next;
    if (cmd.action === 'sync') {
      storage.useAccount(s.accountId, account.prefs, next.rev);
      if (cmd.body.merge) wx.removeStorageSync('lianna.preferences.v1');
    }
    return account;
  } catch (e) {
    if (e.status === 409) {
      await refresh();
      if (cmd.action === 'sync') {
        cmd.rev = account.rev;
        wx.setStorageSync(k, cmd);
      } else if (
        await confirm(
          '另一个设备已修改数据',
          '保留本次输入，或放弃待提交操作并重新载入最新记录？确认将放弃旧操作。'
        )
      )
        wx.removeStorageSync(k);
    } else if (e.status && e.status < 500 && e.status !== 401) wx.removeStorageSync(k);
    throw e;
  }
}
function mutate(action, body) {
  const owner = credentials()?.accountId;
  const task = mutationQueue.then(() => {
    if (credentials()?.accountId !== owner) throw new Error('账号已切换，请重新操作');
    return performMutation(action, body);
  });
  mutationQueue = task.catch(() => {});
  return task;
}
async function performMutation(action, body) {
  if (!credentials()) throw Error('请先登录');
  if (wx.getStorageSync(pendingKey())) await sendPending();
  if (!account) await refresh();
  const cmd = {
    action,
    body,
    rev: account.rev,
    requestId:
      Date.now().toString(36) +
      '-' +
      Math.random().toString(36).slice(2) +
      '-' +
      Math.random().toString(36).slice(2)
  };
  wx.setStorageSync(pendingKey(), cmd);
  return sendPending();
}
function clearLocal() {
  const s = credentials();
  if (s) {
    wx.removeStorageSync(pendingKey());
    storage.useAccount(null);
    wx.removeStorageSync('lianna.preferences.account.' + s.accountId);
  }
  wx.removeStorageSync(sessionKey);
  account = null;
}
async function logout() {
  if (wx.getStorageSync(pendingKey())) await sendPending();
  try {
    await request('logout');
  } catch (e) {
    if (e.status !== 401) throw e;
  }
  clearLocal();
}
async function sync() {
  if (!credentials()) return login();
  await sendPending();
  await refresh();
  const first = !storage.inAccount();
  if (!first && !storage.dirty()) {
    storage.useAccount(credentials().accountId, account.prefs, account.rev);
    return account;
  }
  return mutate('sync', { ...storage.read(), merge: first, base: storage.savedBase() });
}
function localDate(d = new Date()) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('-');
}
function shift(s, n) {
  const d = new Date(s + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return localDate(d);
}
function monday(s = localDate()) {
  return shift(s, -((new Date(s + 'T12:00:00').getDay() + 6) % 7));
}
async function run(page, fn) {
  if (page.data.busy) return;
  page.setData({ busy: true, error: '' });
  try {
    await fn();
  } catch (e) {
    page.setData({ error: e.message || '操作失败，请重试' });
  } finally {
    page.setData({ busy: false });
  }
}
module.exports = {
  asset: path => /^\/avatars\/[a-f0-9]{48}$/.test(path || '') ? base() + path : '',
  request,
  credentials,
  refresh,
  login,
  logout,
  sync,
  sendPending,
  mutate,
  confirm,
  alert,
  localDate,
  shift,
  monday,
  run,
  state: () => account
};
