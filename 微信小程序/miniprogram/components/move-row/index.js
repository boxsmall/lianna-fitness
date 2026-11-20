const { toggleFavorite } = require('../../lib/storage');
Component({
  properties: { move: { type: Object, value: {} }, selecting: Boolean },
  data: { broken: false },
  observers: {
    'move.cover': function () {
      if (this.data.broken) this.setData({ broken: false });
    }
  },
  methods: {
    open() {
      wx.navigateTo({
        url: '/pages/detail/index?id=' + encodeURIComponent(this.data.move.id) + (this.data.selecting ? '&select=1&selected=' + (this.data.move.selected ? '1' : '0') + '&already=' + (this.data.move.already ? '1' : '0') : ''),
        events: { selected: () => this.select() }
      });
    },
    select() {
      this.triggerEvent('select', { id: this.data.move.id });
    },
    save() {
      if (toggleFavorite(this.data.move.id)) this.triggerEvent('changed');
    },
    addToPlan() {
      require('../../lib/navigation').open('week', { add: this.data.move.id });
    },
    coverFailed() {
      this.setData({ broken: true });
    }
  }
});
