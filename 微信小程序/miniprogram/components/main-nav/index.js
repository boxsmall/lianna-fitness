const nav = require('../../lib/navigation');
Component({
  properties: { active: String },
  data: {
    tabs: [
      { key: 'today', label: '今天', icon: 'home' },
      { key: 'week', label: '训练', icon: 'calendar' },
      { key: 'diet', label: '饮食', icon: 'rice' },
      { key: 'account', label: '我的', icon: 'user' }
    ]
  },
  methods: { follow: nav.follow }
});
