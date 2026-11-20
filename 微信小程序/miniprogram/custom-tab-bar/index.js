const nav = require('../lib/navigation');
Component({
  data: {
    selected: 'today', hidden: false,
    tabs: [
      {key:'today',label:'今天',icon:'home'}, {key:'week',label:'训练',icon:'calendar'},
      {key:'diet',label:'饮食',icon:'rice'}, {key:'account',label:'我的',icon:'user'}
    ]
  },
  lifetimes: { attached() { this.syncRoute(); } },
  pageLifetimes: { show() { this.syncRoute(); } },
  methods: {
    follow: nav.follow,
    syncRoute() {
      const page=getCurrentPages().slice(-1)[0], key=page?.route?.split('/')[1];
      if(this.data.tabs.some(t=>t.key===key))this.setData({selected:key,hidden:key==='week' && page.data.mode==='session'});
    }
  }
});
