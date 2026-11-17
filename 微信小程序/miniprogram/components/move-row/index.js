const { toggleFavorite } = require('../../lib/storage');
Component({
  properties: { move: { type: Object, value: {} } },
  data: { broken: false },
  observers: {
    'move.cover': function () { if (this.data.broken) this.setData({ broken: false }); }
  },
  methods: {
    open() {
      wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(this.data.move.id) });
    },
    save() {
      if (toggleFavorite(this.data.move.id)) this.triggerEvent('changed');
    },
    addToPlan(){wx.navigateTo({url:'/pages/week/index?add='+encodeURIComponent(this.data.move.id)});},
    coverFailed() {
      this.setData({ broken: true });
    }
  }
});
