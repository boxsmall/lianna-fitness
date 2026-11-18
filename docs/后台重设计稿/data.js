const users=[
{id:'U10001',name:'林小满',sex:'女',height:165,weight:62.5,goal:'增肌',days:3,time:30,gear:['哑铃','训练垫'],allergy:'花生',avoid:'猪肉',joined:'2026-11-05',active:'今天 10:42',status:'正常',completed:6},
{id:'U10002',name:'陈晓宇',sex:'男',height:178,weight:76,goal:'日常健身',days:2,time:45,gear:['哑铃','训练凳'],allergy:'未提供',avoid:'未提供',joined:'2026-11-08',active:'今天 10:31',status:'正常',completed:4},
{id:'U10003',name:'阿宁',sex:'女',height:160,weight:53,goal:'减脂',days:4,time:30,gear:['弹力带'],allergy:'牛奶',avoid:'未提供',joined:'2026-11-11',active:'今天 09:58',status:'正常',completed:3},
{id:'U10004',name:'周一',sex:'男',height:172,weight:68,goal:'日常健身',days:3,time:20,gear:[],allergy:'未提供',avoid:'未提供',joined:'2026-11-12',active:'昨天 21:36',status:'正常',completed:2},
{id:'U10005',name:'小北',sex:'未填写',height:null,weight:null,goal:'未设置',days:0,time:0,gear:['单杠'],allergy:'未提供',avoid:'未提供',joined:'2026-11-14',active:'昨天 19:06',status:'正常',completed:0},
{id:'U10006',name:'许晨',sex:'男',height:181,weight:80,goal:'增肌',days:3,time:45,gear:['杠铃','力量架'],allergy:'未提供',avoid:'未提供',joined:'2026-11-15',active:'11-16 18:22',status:'已限制',completed:1},
{id:'U10007',name:'晚风',sex:'女',height:168,weight:59,goal:'日常健身',days:2,time:30,gear:['哑铃'],allergy:'鸡蛋',avoid:'未提供',joined:'2026-11-16',active:'今天 08:51',status:'注销处理中',completed:1},
{id:'U10008',name:'未设置昵称',sex:'未填写',height:null,weight:null,goal:'未设置',days:0,time:0,gear:[],allergy:'未提供',avoid:'未提供',joined:'2026-11-18',active:'今天 08:26',status:'正常',completed:0}
];
const featured=['0334','1760','0293','1459','0274','0662','0292','0668','1368','1167'];
const allMoves=[...exercises].sort((a,b)=>{const ai=featured.indexOf(a.sourceId),bi=featured.indexOf(b.sourceId);return(ai<0?9999:ai)-(bi<0?9999:bi)});
const moveMeta={};
allMoves.forEach((m,i)=>moveMeta[m.sourceId]={live:i!==6,auto:i<8&&i!==6,review:i===0?'待审核':'已发布',version:'v2.1',draft:null});
const favorites=[['U10001','0334'],['U10001','1760'],['U10001','0293'],['U10001','1368'],['U10001','1167'],['U10002','0662'],['U10002','1760'],['U10003','0274'],['U10003','0668'],['U10004','0662'],['U10005','0292'],['U10007','0334']].map(([user,move],i)=>({id:'F'+(2001+i),user,move,date:'2026-11-'+(i%4+14)+' 09:20',event:'添加',source:i%3?'小程序':'游客合并'}));
const favEvents=[...favorites,{id:'E2040',user:'U10001',move:'0274',date:'2026-11-18 09:10',event:'取消',source:'小程序'}];
const plans=users.filter(u=>u.days).map((u,i)=>({id:'P'+(301+i),user:u.id,name:i===0?'哑铃基础三日':u.goal+'周计划',week:'11.16 — 11.22',goal:u.goal,days:u.days,time:u.time,state:i===5?'已归档':'已保存',changed:i===0}));
const generations=[
{id:'G8001',user:'U10001',scene:'替换食材',time:'10:42:08',result:'成功交付',adopt:'修改后保存',input:'午餐 · 鸡胸肉换瘦牛肉',model:'Nutri-S',version:'v1.3',meal:'M501'},
{id:'G8002',user:'U10002',scene:'初次推荐',time:'10:31:24',result:'成功交付',adopt:'已保存',input:'晚餐 · 主食与蛋白质来源',model:'Nutri-S',version:'v1.3',meal:'M502'},
{id:'G8003',user:'U10003',scene:'替换食材',time:'09:58:10',result:'校验拦截',adopt:'未采用',input:'早餐 · 更换蛋白质来源',model:'Nutri-S',version:'v1.3'},
{id:'G8004',user:'U10001',scene:'初次推荐',time:'09:30:15',result:'成功交付',adopt:'未采用',input:'午餐 · 生成候选食材',model:'Nutri-S',version:'v1.3'},
{id:'G8005',user:'U10004',scene:'初次推荐',time:'09:16:30',result:'规则回退',adopt:'未采用',input:'午餐 · 请求超时，转手动选择',model:'Nutri-S',version:'v1.3'},
{id:'G8006',user:'U10007',scene:'替换食材',time:'08:51:45',result:'已取消',adopt:'未采用',input:'晚餐 · 已发出请求后取消',model:'Nutri-S',version:'v1.3'},
{id:'G8007',user:null,scene:'后台测试',time:'08:40:10',result:'成功交付',adopt:'不适用',input:'固定样例 · 提示词对比',model:'Nutri-S',version:'v1.4 草稿'},
{id:'G8008',user:'U10003',scene:'初次推荐',time:'08:20:14',result:'生成失败',adopt:'未采用',input:'早餐 · 返回结构异常',model:'Nutri-S',version:'v1.3'}
];
const calls=[
{id:'C9001',gen:'G8001',seq:1,input:2000,output:500,amount:8000,billing:'账单确认',result:'返回结构异常',time:'10:42:08',duration:'2.4 s'},
{id:'C9002',gen:'G8001',seq:2,input:1000,output:250,amount:4000,billing:'仅估算',result:'成功',time:'10:42:11',duration:'1.8 s'},
{id:'C9003',gen:'G8002',seq:1,input:2500,output:600,amount:9800,billing:'账单确认',result:'成功',time:'10:31:24',duration:'2.1 s'},
{id:'C9004',gen:'G8003',seq:1,input:2100,output:450,amount:7800,billing:'账单确认',result:'成功',time:'09:58:10',duration:'2.0 s'},
{id:'C9005',gen:'G8004',seq:1,input:3000,output:800,amount:12400,billing:'账单确认',result:'成功',time:'09:30:15',duration:'2.8 s'},
{id:'C9006',gen:'G8005',seq:1,input:null,output:null,amount:null,billing:'未获得用量',result:'超时',time:'09:16:30',duration:'20.0 s'},
{id:'C9007',gen:'G8005',seq:2,input:1800,output:0,amount:3600,billing:'仅估算',result:'失败',time:'09:16:51',duration:'1.0 s'},
{id:'C9008',gen:'G8006',seq:1,input:2400,output:300,amount:7200,billing:'仅估算',result:'已取消',time:'08:51:45',duration:'1.2 s'},
{id:'C9009',gen:'G8007',seq:1,input:4000,output:900,amount:15200,billing:'账单确认',result:'成功',time:'08:40:10',duration:'3.1 s'},
{id:'C9010',gen:'G8008',seq:1,input:2000,output:200,amount:5600,billing:'账单确认',result:'返回结构异常',time:'08:20:14',duration:'1.4 s'}
];
const staff=[{id:'A001',name:'林晓',account:'lin.xiao',role:'超级管理员',status:'启用',range:'全部业务',last:'今天 10:55'},{id:'A002',name:'陈然',account:'chen.ran',role:'业务运营',status:'启用',range:'用户与内容',last:'今天 10:32'},{id:'A003',name:'许知',account:'xu.zhi',role:'AI 运营',status:'启用',range:'AI 业务',last:'今天 09:48'},{id:'A004',name:'周可',account:'zhou.ke',role:'客服',status:'启用',range:'分配的用户',last:'今天 09:15'},{id:'A005',name:'季言',account:'ji.yan',role:'业务运营',status:'停用',range:'用户与内容',last:'11-12 18:30'}];
const audit=[
{id:'L6101',time:'10:53:28',who:'林晓',role:'超级管理员',module:'权限管理',action:'调整角色权限',object:'业务运营',result:'成功',before:'内容发布：未授权',after:'内容发布：已授权',reason:'临时承担动作审核'},
{id:'L6102',time:'10:48:12',who:'许知',role:'AI 运营',module:'AI 配置',action:'保存提示词草稿',object:'提示词 v1.4',result:'成功',before:'蛋白质来源候选 2 个',after:'蛋白质来源候选 3 个',reason:'完善可替换食材说明'},
{id:'L6103',time:'10:36:05',who:'陈然',role:'业务运营',module:'动作库',action:'提交动作审核',object:'0334',result:'成功',before:'说明 v2.1',after:'说明 v2.2 草稿',reason:'补充肘部微屈的动作说明'},
{id:'L6104',time:'10:22:40',who:'周可',role:'客服',module:'AI 费用',action:'查看费用明细',object:'C9001',result:'拒绝',before:'无费用查看权限',after:'未返回费用数据',reason:'当前角色无权访问'},
{id:'L6105',time:'09:52:11',who:'林晓',role:'超级管理员',module:'管理员',action:'停用管理员',object:'A005',result:'成功',before:'启用',after:'停用；会话失效',reason:'人员交接完成'},
{id:'L6106',time:'09:40:22',who:'周可',role:'客服',module:'用户资料',action:'查看授权资料',object:'U10001',result:'成功',before:'资料内容不写入日志',after:'读取字段：过敏原、忌口',reason:'关联个案 FB-018'}
];
