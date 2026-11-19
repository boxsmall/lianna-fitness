const tabNames = ['today', 'week', 'diet', 'account'];
function open(page, options = {}) {
  const url = '/pages/' + page + '/index';
  if (tabNames.includes(page)) {
    getApp().globalData.tabIntent = { page, options };
    wx.switchTab({ url });
  } else {
    const query = Object.keys(options)
      .map((key) => key + '=' + encodeURIComponent(options[key]))
      .join('&');
    wx.navigateTo({ url: url + (query ? '?' + query : '') });
  }
}
function take(page) {
  const app = getApp();
  const intent = app.globalData.tabIntent;
  if (intent?.page !== page) return null;
  delete app.globalData.tabIntent;
  return intent.options;
}
function follow(event) {
  const { page, mode, date, meal, id } = event.currentTarget.dataset;
  open(page, {
    ...(id && { id }),
    ...(mode && { mode }),
    ...(date && { date }),
    ...(meal != null && { meal })
  });
}
module.exports = { open, take, follow };
