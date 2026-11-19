const { byId, media, gearLabel } = require('../../lib/catalog');
const storage = require('../../lib/storage');
Page({
  data: { move: null, status: 'loading', animation: '' },
  onLoad(options) {
    this.setData({ selecting: options.select === '1', selected: options.selected === '1', already: options.already === '1' });
    const move = byId.get(options.id);
    if (!move) return;
    this.move = move;
    const saved = storage.read();
    this.setData({
      move: {
        id: move.id,
        name: move.name,
        hidden: !!move.hidden,
        part: move.part,
        muscle: move.muscle,
        steps: move.steps.map((text, index) => ({ order: index + 1, text }))
      },
      gear: gearLabel(move, new Set(saved.active)),
      favorite: saved.favorites.includes(move.id),
      cover: media(move, 'covers'),
      hint:
        move.warmup && move.warmPart !== move.part ? '收藏归入' + move.part : ''
    });
    this.loadAnimation();
  },
  loadAnimation() {
    // image 的 webp 解码开关用于网络资源，保留 HTTPS URL。
    const base = media(this.move, 'animations');
    const attempt = this.attempt || 0;
    const separator = base.includes('?') ? '&' : '?';
    const animation = attempt ? base + separator + 'retry=' + Date.now() : base;
    this.attempt = attempt + 1;
    this.setData({ status: 'loading', animation });
  },
  pause() {
    this.setData({ paused: !this.data.paused });
  },
  loaded() {
    this.setData({ status: 'ready' });
  },
  failed() {
    this.setData({ status: 'error', animation: '' });
    require('../../lib/service')
      .request('media/error', { id: this.move.sourceId })
      .catch(() => {});
  },
  addToPlan() {
    if(this.move.hidden) return wx.showToast({title:"动作已下架，请选择替代动作",icon:"none"});
    if (this.data.selecting) {
      if (this.data.already) return;
      this.getOpenerEventChannel().emit('selected');
      wx.navigateBack();
      return;
    }
    require('../../lib/navigation').open('week', { add: this.move.id, date: require('../../lib/service').localDate() });
  },
  favorite() {
    if (storage.toggleFavorite(this.move.id)) {
      this.setData({
        favorite: storage.read().favorites.includes(this.move.id)
      });
    }
  },
  pick() {
    wx.navigateTo({ url: '/pages/pick/index' });
  }
});
