App({
  onLaunch() { require('./lib/storage').resume(); const updates=require('./lib/updates'); updates.sync(); wx.onNetworkStatusChange(e=>{if(e.isConnected)updates.sync();}); },
  onShow() { require('./lib/updates').sync(); },
  globalData: {
    filters: { parts: [], category: '全部' }
  }
});
