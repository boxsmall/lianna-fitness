const nav = require('../../lib/navigation');
Component({
  properties: { active: String },
  data: {
    tabs: [
      { key: 'today', label: '今天', icon: 'today' },
      { key: 'week', label: '计划', icon: 'plan' },
      { key: 'diet', label: '饮食', icon: 'nutrition' },
      { key: 'account', label: '我的', icon: 'account' }
    ]
  },
  methods: { follow: nav.follow }
});
