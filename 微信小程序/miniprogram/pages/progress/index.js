const api = require('../../lib/service');
const nav = require('../../lib/navigation');
Page({
  data: { date: '', today: '', weight: '', from:'', to:'', records:[], nextOffset:null, assessmentOpen:false, assessmentAdherence:'', assessmentWellbeing:'', assessmentWater:'', waterOptions:['无影响','仍有影响','不确定'], adherence: '未记录', wellbeing: '正常', waterChange: false,
    adherenceOptions: ['基本按计划', '偏多', '偏少', '未记录'], wellbeingOptions: ['正常', '明显饥饿或疲劳', '训练表现下降'], result: null, error: '', busy: false },
  follow: nav.follow,
  onShow() { this.setData({ date: api.localDate(), today: api.localDate() }); return api.run(this, async()=> { if (!(await api.login())) return; await this.reload(); }); },
  async reload() {
    const a = await api.refresh(), result = await api.request('energy/progress',this.query());
    this.setData({ result, records:result.records, nextOffset:result.nextOffset, profile: a.profile || null, goal: a.stageGoal || a.profile?.goal || '未设置' });
    this.readDate();
  },
  readDate() {
    const a = api.state(), record = a?.measurements?.[this.data.date], feedback = a?.energyFeedback?.[this.data.date];
    this.setData({ weight: record?.weight || '', adherence: feedback?.adherence || '未记录', wellbeing: feedback?.wellbeing || '正常', waterChange: feedback?.waterChange || false });
  },
  field(e) { this.setData({ [e.currentTarget.dataset.k]: e.detail.value }); if (e.currentTarget.dataset.k === 'date') this.readDate(); },
  pick(e) { const { k, list } = e.currentTarget.dataset; this.setData({ [k]: this.data[list][Number(e.detail.value)] }); },
  saveWeight() { return api.run(this, async()=> {
    const weight=Number(this.data.weight),old=api.state()?.measurements?.[this.data.date];
    if(!Number.isFinite(weight)||weight<=0)throw Error('请填写有效正数，单位千克');
    let confirmOverwrite=false;
    if(old && old.weight!==weight) {
      if(!(await api.confirm('确认修改当天体重',this.data.date+'：原值 '+old.weight+' kg → '+weight+' kg，确认覆盖？')))return;
      confirmOverwrite=true;
    }
    await api.mutate('measurement',{date:this.data.date,weight,confirmOverwrite,previousWeight:old?.weight});
    await this.reload(); wx.showToast({ title: '体重已记录' });
  }); },
  saveFeedback() { return api.run(this, async()=> {
    const { date, adherence, wellbeing, waterChange } = this.data;
    await api.mutate('energyFeedback', { date, adherence, wellbeing, waterChange });
    await this.reload(); wx.showToast({ title: '反馈已保存' });
  }); },
  query(offset=0) {return {from:this.data.from || undefined,to:this.data.to || undefined,offset};},
  assess() {this.setData({assessmentOpen:true,assessmentAdherence:'',assessmentWellbeing:'',assessmentWater:''});},
  closeAssessment() {this.setData({assessmentOpen:false});},
  saveAssessment() {return api.run(this,async()=> {
    const d=this.data;
    if(!d.assessmentAdherence||!d.assessmentWellbeing||!d.assessmentWater)throw Error('请确认近期整体执行、当前身体感受和波动情况');
    await api.mutate('energyAssessment',{adherence:d.assessmentAdherence,wellbeing:d.assessmentWellbeing,waterStatus:d.assessmentWater});
    this.setData({assessmentOpen:false});await this.reload();
  });},
  filterRecords() {return api.run(this,async()=>this.reload());},
  clearFilter() {this.setData({from:'',to:''});return this.filterRecords();},
  more() {return api.run(this,async()=> {
    if(this.data.nextOffset==null)return;
    const r=await api.request('energy/progress',this.query(this.data.nextOffset));
    this.setData({records:[...this.data.records,...r.records],nextOffset:r.nextOffset});
  });},
  accept() { return api.run(this, async()=> {
    const r = this.data.result?.recommendation;
    if (!r || !(await api.confirm('确认饮食调整', r.effectiveFrom + ' 起每日 ' + r.targets.kcal + ' 千卡，三类营养一起更新。今天的目标保持不变。'))) return;
    await api.mutate('acceptEnergy', { id: r.id }); await this.reload();
  }); },
  cancel() { return api.run(this, async()=> {
    if (!(await api.confirm('取消待生效调整', '继续使用当前饮食目标？'))) return;
    await api.mutate('cancelEnergy', {}); await this.reload();
  }); }
});
