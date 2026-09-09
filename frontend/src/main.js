
/* ================= 数据层 ================= */
const LS_KEY='presales_workbench_v3';
let store={projects:[],kb:[],docs:[],tasks:[],kbTree:[],pdocs:{},checklists:{},
  stakeholders:{},contracts:{},quotations:{},compintel:[],requirements:{},followups:{}};
let editingProjectId=null, currentProjectId=null, kbEditingId=null;

const DEF_CATS=['产品资料','案例库','技术方案素材','公司资质与实力','竞品情报','话术与FAQ','模板与规范'];
/* 一期主档：商机级别与 C139 相互独立（级别是人的判断，C139 是模型评分，不联动） */
const OPP_LEVELS=['控单','博弈','了解中'];
const LOST_STAGES=['已流标','已输标','项目已取消'];
function num0(v){const n=parseFloat(v);return isFinite(n)?n:0}
function fmtWan(n){n=num0(n);return n%1===0?String(n):n.toFixed(1)}
function amountsOf(p){const a=(p&&p.amounts)||{};return{est:num0(a.estTotal),sw:num0(a.software),won:num0(a.won),cost:num0(a.cost)}}
function marginOf(p){const m=amountsOf(p);const profit=m.won?+(m.won-m.cost).toFixed(1):0;const rate=m.won?Math.round(profit/m.won*1000)/10:null;return Object.assign({},m,{profit,rate})}
function oppBadge(l){if(!l)return '—';const cls=l==='控单'?'b-win':l==='博弈'?'b-plan':'b-pre';return `<span class="badge ${cls}">${esc(l)}</span>`}
function persist(){try{localStorage.setItem(LS_KEY,JSON.stringify(store))}catch(e){}try{schedulePush()}catch(e){}}
function load(){try{const s=localStorage.getItem(LS_KEY);if(s)store=JSON.parse(s)}catch(e){}
  if(!store.projects)store={projects:[],kb:[],docs:[],tasks:[],kbTree:[],pdocs:{},checklists:{},
    stakeholders:{},contracts:{},quotations:{},compintel:[],requirements:{}};
  if(!store.tasks)store.tasks=[];if(!store.docs)store.docs=[];if(!store.checklists)store.checklists={};
  if(!store.pdocs)store.pdocs={};
  if(!store.stakeholders)store.stakeholders={};
  if(!store.contracts)store.contracts={};
  if(!store.quotations)store.quotations={};
  if(!store.compintel)store.compintel=[];
  if(!store.requirements)store.requirements={};
  if(!store.followups)store.followups={};
  if(!store.kbTree||!store.kbTree.length){
    store.kbTree=DEF_CATS.map(n=>({id:uid(),name:n,pid:null}));
    store.kb.forEach(k=>{if(k.category!==undefined){const n=store.kbTree.find(t=>t.name===k.category);k.catId=n?n.id:null;delete k.category}});
  }}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function fmtDate(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function today(){return fmtDate(new Date())}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.style.display='block';clearTimeout(t._h);t._h=setTimeout(()=>t.style.display='none',2200)}

/* ================= C139 模型 ================= */
const C139_CONSENSUS=[
  '决定者及决策结构中的主关键人认为我们的价值耦合度最高',
  '决策结构中的主关键人主动协助我们策划、实施项目获取过程',
  '决策结构指定的甄选模型选定我们'];
const C139_FACTORS=[
  ['我们的推进流程和关键节点','同类项目经验 + 本项目推进节奏是否清晰'],
  ['客户的采购流程和关键节点','同类项目 + 本项目的采购路径、时间节点'],
  ['客户的组织结构 / 主要成员共鸣点','组织架构、关键人的个人诉求'],
  ['决策结构及成员的影响力/定位/倾向','谁说了算、各自立场'],
  ['立项原因及各成员的决策点','为什么立项、每人关心什么'],
  ['客户付款信誉/习惯/资金来源及到位情况','资金风险'],
  ['各参与者可利用的资源及作用','生态、关系资源'],
  ['各参与者的推进活动/SWOT','客户眼中各家友商的优劣势'],
  ['KSF 关键成功要素及 TOP3 活跃情况','赢单关键要素、最前三家的动作']];
function defaultC139(){return{is1W:false,coach:false,consensus:[false,false,false],factors:Array(9).fill(false),note:''}}
function c139Stats(c){
  c=c||defaultC139();
  const F=c.consensus.filter(Boolean).length;
  const N=c.factors.filter(Boolean).length;
  let rate,zone,tip='';
  if(c.coach){ /* 教练确认后的 *C 值 */
    if(c.is1W){rate=F>=3?100:F===2?99:Math.max(90,85+F*3);zone='win';tip='教练确认 + 1Win：接近锁定'}
    else{rate=F>=2?22:F===1?3:0;zone=F>=2?'mid':'lose';tip='无1Win时即使教练确认仍处劣势'}
  }else if(c.is1W){
    rate=N>=9?91:N>=6?85:N>=5?50:50;
    zone=N>=6?'win':'mid';
    tip=N>=5?'5C 为制胜拐点：补齐共识项冲击更高区间':'处于制胜拐点 50%，重点补齐 9 要素';
  }else{
    rate=N>=8?50:N>=7?50:N===6?26:N>=3?15:5;
    zone=N>=7?'mid':(N===6?'mid':'lose');
    tip=N===6?'6C 为死亡拐点：必须争取 1Win 或教练确认':'缺少 1Win / 教练，赢单率受限';
  }
  return{F,N,rate,zone,tip};
}
function zoneBadge(z){return z==='win'?'<span class="zone win">赢单区</span>':z==='mid'?'<span class="zone mid">抖动区</span>':'<span class="zone lose">输单区</span>'}

/* ================= 路由 ================= */
function show(p){
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('on'));
  document.getElementById('p-'+p).classList.add('on');
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('on',b.dataset.p===p));
  if(p==='dash')renderDash();
  if(p==='projects')renderProjects();
  if(p==='kb')renderKb();
  if(p==='pdocs')renderPdocs();
  if(p==='docs')renderDocsPage();
  if(p==='c139')renderC139();
  if(p==='tools')renderTools();
  if(p==='stakeholders')renderStakeholders();
  if(p==='contracts')renderContracts();
  if(p==='quotations')renderQuotations();
  if(p==='compintel')renderCompintel();
  if(p==='requirements')renderRequirements();
}
document.getElementById('nav').addEventListener('click',e=>{const b=e.target.closest('button[data-p]');if(b)show(b.dataset.p)});
function closeMask(id){document.getElementById(id).classList.remove('on')}
function openMask(id){document.getElementById(id).classList.add('on')}

/* ================= 项目管理 ================= */
const STAGES=['前期交流','方案阶段','招投标阶段','已中标','已流标','已输标','项目已取消'];
const STAGE_CLS={'前期交流':'b-pre','方案阶段':'b-plan','招投标阶段':'b-bid','已中标':'b-win','已流标':'b-fail','已输标':'b-lose','项目已取消':'b-cancel'};
function stageBadge(s){return `<span class="badge ${STAGE_CLS[s]||'b-fail'}">${esc(s)}</span>`}

function openProjectModal(id){
  editingProjectId=id||null;
  const p=id?store.projects.find(x=>x.id===id):null;
  const m=amountsOf(p||{});
  document.getElementById('pmTitle').textContent=p?'编辑项目':'新建项目';
  pfName.value=p?p.name:'';pfCust.value=p?p.customer:'';
  pfSales.value=p?(p.sales||p.owner||''):'';pfPre.value=p?(p.presales||''):'';
  pfStage.value=p?p.stage:'前期交流';pfOpp.value=p?(p.oppLevel||'了解中'):'了解中';
  pfEst.value=m.est||'';pfSoft.value=m.sw||'';pfWon.value=m.won||'';pfCost.value=m.cost||'';
  pfExpect.value=p?(p.expectSignMonth||''):'';pfActual.value=p?(p.actualSignMonth||''):'';
  pfDate.value=p?p.keyDate:'';pfBg.value=p?p.source:'';
  pfLostRow.style.display=LOST_STAGES.includes(pfStage.value)?'':'none';pfLost.value=p?(p.lostReason||''):'';
  openMask('mProject');
}
function onPfStageChange(){pfLostRow.style.display=LOST_STAGES.includes(pfStage.value)?'':'none'}
function saveProject(){
  if(!pfName.value.trim()||!pfCust.value.trim()){toast('请填写项目名称与甲方名称');return}
  if(LOST_STAGES.includes(pfStage.value)&&!pfLost.value.trim()){toast('请填写「'+pfStage.value+'」原因');return}
  const base={name:pfName.value.trim(),customer:pfCust.value.trim(),stage:pfStage.value,oppLevel:pfOpp.value,
    sales:pfSales.value.trim(),presales:pfPre.value.trim(),
    amounts:{estTotal:num0(pfEst.value),software:num0(pfSoft.value),won:num0(pfWon.value),cost:num0(pfCost.value)},
    expectSignMonth:pfExpect.value,actualSignMonth:pfActual.value,keyDate:pfDate.value,source:pfBg.value,
    lostReason:LOST_STAGES.includes(pfStage.value)?pfLost.value.trim():''};
  if(editingProjectId){
    const p=store.projects.find(x=>x.id===editingProjectId);
    Object.assign(p,base);addTl(p,'更新项目基本信息');
  }else{
    const p=Object.assign({id:uid(),progressText:'',created:today(),c139:defaultC139(),tasks:[],timeline:[],bg:{},docs:[]},base);
    store.projects.unshift(p);addTl(p,'创建项目');
    currentProjectId=p.id;
  }
  persist();closeMask('mProject');renderProjects();toast('已保存');
}
function addTl(p,text){p.timeline=p.timeline||[];p.timeline.unshift({d:today(),t:text})}
function delProject(id){if(!confirm('确定删除该项目？'))return;store.projects=store.projects.filter(p=>p.id!==id);persist();renderProjects();toast('已删除')}

function renderProjects(){
  const kw=(document.getElementById('projSearch').value||'').toLowerCase();
  const st=document.getElementById('projStageFilter').value;
  let list=store.projects.filter(p=>(st==='all'||p.stage===st)&&(!kw||(p.name+p.customer).toLowerCase().includes(kw)));
  const t=document.getElementById('projTable');
  if(!list.length){t.innerHTML='<tr><td colspan="11"><div class="empty">暂无项目，点击右上角「新建项目」开始</div></td></tr>';return}
  t.innerHTML=`<tr><th>项目</th><th>甲方</th><th>阶段</th><th>商机级别</th><th>预估(万)</th><th>软件(万)</th><th>C139赢单率</th><th>预计签约</th><th>销售</th><th>售前</th><th style="width:170px">操作</th></tr>`+
  list.map(p=>{const s=c139Stats(p.c139);const m=amountsOf(p);return `<tr>
    <td><b style="cursor:pointer;color:var(--brand)" onclick="openDetail('${p.id}')">${esc(p.name)}</b></td>
    <td>${esc(p.customer)}</td><td>${stageBadge(p.stage)}</td><td>${oppBadge(p.oppLevel)}</td>
    <td>${m.est?fmtWan(m.est):'—'}</td><td>${m.sw?fmtWan(m.sw):'—'}</td>
    <td><div class="wr"><span class="pct" style="color:${s.rate>=85?'var(--ok)':s.rate>=50?'#b25e0c':'var(--bad)'}">${s.rate}%</span>${zoneBadge(s.zone)}</div></td>
    <td>${esc(p.expectSignMonth||p.keyDate||'—')}</td><td>${esc(p.sales||'—')}</td><td>${esc(p.presales||'—')}</td>
    <td><button class="btn sm ghost" onclick="openDetail('${p.id}')">详情</button>
        <button class="btn sm ghost" onclick="openProjectModal('${p.id}')">编辑</button>
        <button class="btn sm danger" onclick="delProject('${p.id}')">删除</button></td></tr>`}).join('');
}
function filterStage(s){document.getElementById('projStageFilter').value=s;renderProjects()}

/* ================= 项目详情 ================= */
let dtTab='info';
function openDetail(id){currentProjectId=id;dtTab='info';show('detail');renderDetail()}
function getProj(id){return store.projects.find(p=>p.id===(id||currentProjectId))}
function changeStage(v){const p=getProj();if(!p)return;
  if(LOST_STAGES.includes(v)&&!p.lostReason){const r=prompt('请输入「'+v+'」原因（必填）');if(r===null)return;if(!r.trim()){toast('必须填写原因');return}p.lostReason=r.trim()}
  if(!LOST_STAGES.includes(v))p.lostReason='';
  p.stage=v;addTl(p,'阶段变更为「'+v+'」'+(p.lostReason?'：'+p.lostReason:''));persist();renderDetail();show('detail')}
function renderDetail(){
  const p=getProj();if(!p){show('projects');return}
  const s=c139Stats(p.c139);const m=marginOf(p);
  document.getElementById('dtTitle').textContent=p.name;
  document.getElementById('dtSub').innerHTML=`${esc(p.customer)} · 销售 ${esc(p.sales||'—')} / 售前 ${esc(p.presales||'—')} · ${oppBadge(p.oppLevel)} · 预估 ${m.est?fmtWan(m.est)+' 万':'—'} · C139赢单率 <b>${s.rate}%</b> ${zoneBadge(s.zone)}`;
  document.getElementById('dtStage').value=p.stage;
  const order=['前期交流','方案阶段','招投标阶段','已中标'];
  const lost=LOST_STAGES.includes(p.stage);
  const ci=order.indexOf(p.stage);
  document.getElementById('dtFlow').innerHTML=order.map((st,i)=>{
    const cls=lost?(i<=2?'done':''):(i<ci?'done':i===ci?'cur':'');
    return `<div class="step ${cls}"><div class="dot">${i<ci?'✓':i+1}</div>${st}</div>`}).join('')+
    (lost?`<div class="step cur"><div class="dot" style="background:var(--bad);color:#fff">✕</div>${p.stage}</div>`:'');
  document.querySelectorAll('#dtTabs button').forEach(b=>b.classList.toggle('on',b.dataset.t===dtTab));
  document.getElementById('dtBody').innerHTML=({renderDtInfo,renderDtFollow,renderDtPlan,renderDtRisk,renderDtTask,renderDtTl,renderDtC139,renderDtDoc,renderDtStk,renderDtContract})[
    {info:'renderDtInfo',fu:'renderDtFollow',plan:'renderDtPlan',risk:'renderDtRisk',task:'renderDtTask',tl:'renderDtTl',c:'renderDtC139',doc:'renderDtDoc',stk:'renderDtStk',contract:'renderDtContract'}[dtTab]](p);
}
document.getElementById('dtTabs').addEventListener('click',e=>{const b=e.target.closest('button');if(b){dtTab=b.dataset.t;renderDetail()}});

const BG_FIELDS=[
 ['org','客户组织架构 / 信息化现状'],['why','立项原因与业务痛点'],['chain','决策链与关键人（角色/立场/诉求）'],
 ['money','预算与资金来源'],['buy','采购方式与流程（招标/竞谈/单一来源）'],['rival','竞争对手情况（各家动作/优劣势）'],
 ['swot','我方 SWOT 分析'],['ksf','KSF 关键成功要素'],['nodes','关键时间节点（调研/交流/招标/上线）']];
function renderDtInfo(p){
  p.bg=p.bg||{};
  const m=marginOf(p);const rate=c139Stats(p.c139).rate;
  const wgt=Math.round(m.est*rate)/100;
  return `<div class="card"><h3>项目基本信息</h3><div class="grid g4" style="font-size:13px">
    <div><span style="color:var(--sub)">甲方</span><br><b>${esc(p.customer)}</b></div>
    <div><span style="color:var(--sub)">销售 / 售前</span><br><b>${esc(p.sales||'—')} / ${esc(p.presales||'—')}</b></div>
    <div><span style="color:var(--sub)">商机级别</span><br><b>${oppBadge(p.oppLevel)}</b></div>
    <div><span style="color:var(--sub)">创建日期</span><br><b>${esc(p.created||'—')}</b></div>
    <div><span style="color:var(--sub)">预计签约月</span><br><b>${esc(p.expectSignMonth||'—')}</b></div>
    <div><span style="color:var(--sub)">实际签约月</span><br><b>${esc(p.actualSignMonth||'—')}</b></div>
    <div><span style="color:var(--sub)">关键日期（投标/开标）</span><br><b>${esc(p.keyDate||'—')}</b></div>
    <div><span style="color:var(--sub)">C139 赢单率</span><br><b>${rate}%</b></div></div>
    <div style="margin-top:10px"><span style="color:var(--sub)">项目来源</span><br>${esc(p.source||'—')}</div>
    ${p.lostReason?`<div style="margin-top:8px;color:var(--bad)"><b>${esc(p.stage)}原因：</b>${esc(p.lostReason)}</div>`:''}
    <label class="f" style="margin-top:8px"><span>当前进展（一段话小结）</span>
    <textarea rows="2" onchange="getProj().progressText=this.value;persist();toast('已保存')">${esc(p.progressText||'')}</textarea></label></div>
    <div class="card"><h3>金额与毛利（万元）</h3><div class="grid g4" style="font-size:13px">
    <div><span style="color:var(--sub)">预估合同额</span><br><b>${m.est?fmtWan(m.est):'—'}</b></div>
    <div><span style="color:var(--sub)">软件合同额</span><br><b>${m.sw?fmtWan(m.sw):'—'}</b></div>
    <div><span style="color:var(--sub)">中标合同额</span><br><b>${m.won?fmtWan(m.won):'—'}</b></div>
    <div><span style="color:var(--sub)">项目成本</span><br><b>${m.cost?fmtWan(m.cost):'—'}</b></div>
    <div><span style="color:var(--sub)">毛利（中标−成本）</span><br><b style="color:${m.won?(m.profit>=0?'var(--ok)':'var(--bad)'):'var(--sub)'}">${m.won?fmtWan(m.profit):'—'}</b></div>
    <div><span style="color:var(--sub)">毛利率</span><br><b>${m.rate===null?'—':m.rate+'%'}</b></div>
    <div><span style="color:var(--sub)">加权金额（预估×赢单率）</span><br><b>${m.est?fmtWan(wgt):'—'}</b></div>
    <div><span style="color:var(--sub)">中标 ÷ 预估</span><br><b>${(m.won&&m.est)?Math.round(m.won/m.est*100)+'%':'—'}</b></div></div>
    <div class="hint" style="margin-top:8px">金额在「编辑项目」里维护；毛利=中标合同额−项目成本，毛利率=毛利÷中标合同额，加权金额用于经营视角排序。</div></div>
    <div class="card"><h3>项目背景收集表（售前第一动作，随交流持续更新）</h3>
    ${BG_FIELDS.map(f=>`<label class="f"><span>${f[1]}</span>
      <textarea rows="2" onchange="getProj().bg['${f[0]}']=this.value;addTl(getProj(),'更新了背景：${f[1]}');persist()">${esc(p.bg[f[0]]||'')}</textarea></label>`).join('')}
    </div>`;
}
function renderDtTask(p){
  return `<div class="card"><h3>推进计划与任务</h3>
    <div style="display:flex;gap:8px;margin-bottom:10px"><input id="newTask" placeholder="输入任务，回车添加" onkeydown="if(event.key==='Enter')addTask()">
    <button class="btn" onclick="addTask()">添加</button></div>
    ${(p.tasks||[]).map((t,i)=>`<div class="task ${t.done?'done':''}"><input type="checkbox" ${t.done?'checked':''} onchange="getProj().tasks[${i}].done=this.checked;persist();renderDetail()">
      <span style="flex:1">${esc(t.title)}</span><button class="btn sm danger" onclick="getProj().tasks.splice(${i},1);persist();renderDetail()">✕</button></div>`).join('')||'<div class="empty">暂无任务</div>'}
    <div class="hint" style="margin-top:14px">📌 阶段标准动作参考：<b>前期交流</b>—背景收集/首次交流PPT/识别决策结构；<b>方案阶段</b>—技术方案PPT/高层汇报/建立教练(Coach)；<b>招投标</b>—投标Word方案/述标PPT/答疑澄清；<b>结果</b>—中标签约或复盘输标/流标。</div></div>`;
}
function addTask(){const v=document.getElementById('newTask').value.trim();if(!v)return;const p=getProj();p.tasks.push({title:v,done:false});addTl(p,'新增任务：'+v);persist();renderDetail()}
function renderDtTl(p){
  return `<div class="card"><h3>项目时间线</h3>
    <div style="display:flex;gap:8px;margin-bottom:12px"><input id="tlText" placeholder="记录一条进展/事件，如：完成客户处室汇报，反馈积极">
    <button class="btn" onclick="addTlEntry()">记录</button></div>
    ${(p.timeline||[]).map(t=>`<div class="tl-item"><div class="d">${esc(t.d)}</div><div class="t">${esc(t.t)}</div></div>`).join('')||'<div class="empty">暂无记录</div>'}</div>`;
}
function addTlEntry(){const v=document.getElementById('tlText').value.trim();if(!v)return;const p=getProj();addTl(p,v);persist();renderDetail();toast('已记录')}
function renderDtC139(p){
  const s=c139Stats(p.c139);
  return `<div class="card"><h3>C139 快速评估</h3>
    <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
      <div style="font-size:38px;font-weight:800;color:${s.rate>=85?'var(--ok)':s.rate>=50?'#b25e0c':'var(--bad)'}">${s.rate}%</div>
      <div>${zoneBadge(s.zone)}<div style="color:var(--sub);font-size:12px;margin-top:4px">1Win:${p.c139.is1W?'✔':'✘'} · 教练确认:${p.c139.coach?'✔':'✘'} · 共识 ${s.F}/3 · 要素 ${s.N}/9</div></div>
      <div style="flex:1"></div>
      <button class="btn" onclick="document.getElementById('c139Proj').value='${p.id}';show('c139')">进入完整评估 →</button></div>
    <div class="hint" style="margin-top:12px">${esc(s.tip)}</div></div>`;
}
function renderDtDoc(p){
  const docs=store.docs.filter(d=>d.projectId===p.id);
  const tasks=(store.tasks||[]).filter(t=>t.projectId===p.id);
  return `<div class="card"><h3>本项目制作任务</h3>
    ${tasks.length?tasks.map(t=>{const stName={chat:'对话中',ready:'待生成',draft:'已有初稿'}[t.status];return `
      <div class="trow"><span class="dico" style="font-size:18px">${DOC_TYPES[t.type].icon}</span><div class="tt"><b>${esc(t.title||DOC_TYPES[t.type].name)}</b><small>${DOC_TYPES[t.type].name} · ${esc(t.created)} · ${t.msgs.length} 条对话</small></div>
      <span class="st ${t.status}">${stName}</span><button class="btn sm" onclick="openTaskQw('${t.id}');show('docs');renderDocsPage()">继续任务 →</button></div>`}).join('')
    :'<div class="empty">暂无任务，去「方案制作中心」创建第一个</div>'}
    <div style="margin-top:12px"><button class="btn" onclick="show('docs')">前往方案制作中心 →</button></div></div>
    <div class="card"><h3>已存档文档</h3>
    ${docs.length?`<table><tr><th>类型</th><th>标题</th><th>日期</th><th></th></tr>`+docs.map(d=>`<tr><td>${esc(d.typeName)}</td><td><b>${esc(d.title)}</b></td><td>${esc(d.date)}</td>
      <td><button class="btn sm ghost" onclick="viewDoc('${d.id}')">查看</button> <button class="btn sm danger" onclick="store.docs=store.docs.filter(x=>x.id!=='${d.id}');persist();renderDetail()">删除</button></td></tr>`).join('')+'</table>'
    :'<div class="empty">还没有存档文档，在任务编辑器中点击「存档到项目」</div>'}</div>`;
}
function viewDoc(id){
  const d=store.docs.find(x=>x.id===id);if(!d)return;
  document.getElementById('docViewTitle').textContent=d.title+'（'+d.date+' 存档）';
  document.getElementById('docViewBody').innerHTML=d.html;
  openMask('mDocView');
}

/* ================= 向量知识库 ================= */
let kbSelCat='all';
function childrenOf(pid){return (store.kbTree||[]).filter(n=>(n.pid||null)===pid)}
function descIds(id){let r=[id];childrenOf(id).forEach(c=>{r=r.concat(descIds(c.id))});return r}
function catName(id){const n=(store.kbTree||[]).find(x=>x.id===id);return n?n.name:'未分类'}
function addCatNode(pid){const name=prompt((pid?'在「'+catName(pid)+'」下':'根级')+'新建目录名称：');if(!name||!name.trim())return;store.kbTree.push({id:uid(),name:name.trim(),pid:pid||null});persist();renderKb();toast('目录已创建')}
function renameCatNode(id){const n=store.kbTree.find(x=>x.id===id);const name=prompt('重命名目录：',n.name);if(!name||!name.trim())return;n.name=name.trim();persist();renderKb()}
function kbScore(k,words){
  let sc=0;const title=k.title.toLowerCase(),tags=k.tags.join(' ').toLowerCase(),body=k.content.toLowerCase();
  words.forEach(w=>{if(title.includes(w))sc+=5;if(tags.includes(w))sc+=3;if(body.includes(w))sc+=1});
  return sc;
}


/* ---- 召回调试（模拟向量检索） ---- */
function openDebug(){document.getElementById('dbgOut').innerHTML='';document.getElementById('dbgQ').value='';openMask('mDebug');setTimeout(()=>document.getElementById('dbgQ').focus(),100)}
function runDebug(){
  const q=(document.getElementById('dbgQ').value||'').toLowerCase().split(/\s+/).filter(Boolean);
  if(!q.length){toast('请输入问题');return}
  const pool=[];
  store.kb.forEach(k=>{
    const segs=k.segs&&k.segs.length?k.segs:k.content.split(/\n{2,}/).filter(Boolean);
    segs.forEach((s,i)=>{
      let sc=0;q.forEach(w=>{if(s.toLowerCase().includes(w))sc+=3;if(k.title.toLowerCase().includes(w))sc+=2});
      if(sc>0)pool.push({k,i,s,sc})})});
  pool.sort((a,b)=>b.sc-a.sc);
  const top=pool.slice(0,8);const max=top.length?top[0].sc:1;
  document.getElementById('dbgOut').innerHTML=top.length?
    `<div class="hint">召回 ${pool.length} 个分段，展示 TOP ${top.length}（相似度为本地模拟打分，接入真实 embedding 后替换为余弦相似度）</div>`+
    top.map(x=>`<div class="seg-card"><b>《${esc(x.k.title)}》 · 分段 #${x.i+1} · ${x.k.file?'文件入库':'手工录入'}</b>
      <div style="display:flex;gap:10px;align-items:center;margin:5px 0"><div class="sim"><i style="width:${Math.round(x.sc/max*100)}%"></i></div><small style="color:var(--sub)">相似度 ${Math.min(0.97,0.55+x.sc/max*0.42).toFixed(2)}</small></div>
      ${esc(x.s.slice(0,240))}${x.s.length>240?'…':''}</div>`).join('')
    :'<div class="empty">未召回到相关分段 —— 请确认已通过「添加内容」完成向量化入库，或更换关键词</div>';
}

/* ================= 项目知识库 ================= */
let pdPid=null,pdTab='input',pdFolder='root',pdPending=null;
const PD_TABS={input:['📥 输入','客户提供的全部输入文档（招标文件、需求说明书、图纸、纪要、往来函件…）'],
  process:['🔄 过程','手动增加的工作文档；可创建目录分类管理；方案制作中心产出可一键收纳到此'],
  output:['📤 输出','凡是对外提供过的文档都放这里（已递交标书、述标PPT、承诺方案版本…）'],
  ref:['📎 参考资料','本项目参考了哪些材料，按实际情况自行归类（标准规范、行业报告、同行案例…）']};
function pdOf(pid){if(!store.pdocs[pid])store.pdocs[pid]={input:[],process:{folders:[],docs:[]},output:[],ref:[]};return store.pdocs[pid]}
function pdCount(pid){const d=store.pdocs[pid];if(!d)return 0;return d.input.length+d.process.docs.length+d.output.length+d.ref.length+d.process.folders.reduce((s,f)=>s+f.docs.length,0)}
function fmtSize(b){return !b?'—':b>1048576?(b/1048576).toFixed(1)+' MB':b>1024?(b/1024).toFixed(0)+' KB':b+' B'}
function renderPdocs(){
  const tree=document.getElementById('pdTree');
  tree.innerHTML=store.projects.map(p=>`<div class="pnode ${p.id===pdPid?'on':''}" onclick="pdPid='${p.id}';pdFolder='root';renderPdocs()">
    <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span>
    <span class="sub-cnt">${pdCount(p.id)} 文档</span></div>`).join('')||'<div class="empty">暂无项目</div>';
  const el=document.getElementById('pdRight');
  const p=getProj(pdPid);
  if(!p){el.innerHTML='<div class="empty">👈 在左侧选择一个项目，管理其四类文档</div>';return}
  const [tn,td]=PD_TABS[pdTab];const d=pdOf(p.id);
  let h=`<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
    <div><h3 style="margin-bottom:2px">${esc(p.name)}</h3><div style="font-size:12px;color:var(--sub)">${esc(p.customer)} · ${esc(td)}</div></div>
    <div style="display:flex;gap:8px"><label class="btn sm" style="cursor:pointer">⬆ 上传文件<input type="file" multiple style="display:none" onchange="pdUpload(this)"></label>
    <button class="btn sm ghost" onclick="pdOpenAdd()">📝 登记文档记录</button></div></div>
  <div class="tabs" style="margin:14px 0 12px">${Object.entries(PD_TABS).map(([k,v])=>`<button class="${k===pdTab?'on':''}" onclick="pdTab='${k}';pdFolder='root';renderPdocs()">${v[0]}</button>`).join('')}</div>`;
  if(pdTab==='process'){
    h+=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
      <span class="fchip ${pdFolder==='root'?'on':''}" onclick="pdFolder='root';renderPdocs()">📂 未分类 · ${d.process.docs.length}</span>
      ${d.process.folders.map(f=>`<span class="fchip ${pdFolder===f.id?'on':''}" onclick="pdFolder='${f.id}';renderPdocs()">📁 ${esc(f.name)} · ${f.docs.length}
        <button title="重命名" onclick="event.stopPropagation();pdRenFolder('${f.id}')">✎</button>
        <button title="删除目录（文档移回未分类）" onclick="event.stopPropagation();pdDelFolder('${f.id}')">✕</button></span>`).join('')}
      <button class="btn sm ghost" onclick="pdAddFolder()">＋ 新建目录</button></div>`;
  }
  const docs=pdTab==='process'?(pdFolder==='root'?d.process.docs:((d.process.folders.find(f=>f.id===pdFolder)||d.process).docs)):d[pdTab];
  h+=pdDocsTable(docs);
  el.innerHTML=h;
}
function pdDocsTable(docs){
  if(!docs.length)return `<div class="empty">此分类暂无文档。可「⬆上传文件」「📝登记记录」${pdTab==='process'?'，或从方案制作中心「收纳产出文档」':''}</div>`;
  return `<div style="overflow-x:auto"><table><tr><th>文档名称</th><th>类型</th><th>大小</th><th>日期</th><th>来源</th><th>备注</th><th style="width:200px">操作</th></tr>`+
  docs.map(dc=>`<tr><td><b>${esc(dc.name)}</b></td><td>${esc(dc.kind||'—')}</td><td>${fmtSize(dc.size)}</td><td>${esc(dc.date||'—')}</td>
    <td><span class="tag">${esc(dc.from||'手动登记')}</span></td><td style="max-width:220px">${esc(dc.note||'')}</td>
    <td>${dc.content?`<button class="btn sm ghost" onclick="pdView('${dc.id}')">预览</button>`:''}
        ${dc.fileId?`<a class="btn sm ghost" href="/api/files/download/${encodeURIComponent(dc.fileId)}" target="_blank" title="原件已存服务器 SQLite">下载</a>`:''}
        <button class="btn sm ghost" onclick="pdMove('${dc.id}')">移动</button>
        <button class="btn sm danger" onclick="pdDel('${dc.id}')">删除</button>${(!dc.content&&!dc.fileId)?'<span class="sub-cnt">仅登记</span>':''}</td></tr>`).join('')+'</table></div>';
}
function pdFind(id){
  for(const pid in store.pdocs){const d=store.pdocs[pid];
    for(const tab of['input','output','ref']){const i=d[tab].findIndex(x=>x.id===id);if(i>-1)return{list:d[tab],i,tab,pid}}
    let ri=d.process.docs.findIndex(x=>x.id===id);if(ri>-1)return{list:d.process.docs,i:ri,tab:'process',pid};
    for(const f of d.process.folders){const fi=f.docs.findIndex(x=>x.id===id);if(fi>-1)return{list:f.docs,i:fi,tab:'process',pid}}}
  return null;
}
function pdTargetList(d){return pdTab==='process'?(pdFolder==='root'?d.process.docs:((d.process.folders.find(f=>f.id===pdFolder)||d.process).docs)):d[pdTab]}
async function pdUpload(inp){
  if(!pdPid){toast('请先选择项目');return}
  const d=pdOf(pdPid);const target=pdTargetList(d);
  const files=[...inp.files];inp.value='';
  for(const f of files){
    const ext=(f.name.split('.').pop()||'').toLowerCase();
    const dc={id:uid(),name:f.name,kind:ext.toUpperCase(),size:f.size,date:today(),from:'上传',note:'',content:'',fileId:null};
    target.push(dc);persist();renderPdocs();
    if(['txt','md','markdown','csv','json','log','yaml','yml','xml','html','htm'].includes(ext)){
      const r=new FileReader();r.onload=()=>{dc.content=String(r.result).slice(0,50000);persist();renderPdocs()};r.readAsText(f,'utf-8');
    }
    try{
      const up=await fetch('/api/files/upload',{method:'POST',headers:{'x-filename':encodeURIComponent(f.name),'x-scope':encodeURIComponent('pdocs/'+pdPid)},body:f});
      const uj=await up.json().catch(()=>({}));
      if(!up.ok||!uj.fileId)throw new Error(uj.error||('HTTP '+up.status));
      dc.fileId=uj.fileId;dc.size=uj.size||f.size;
    }catch(e){dc.note=((dc.note?dc.note+' | ':'')+'原件入库失败：'+((e&&e.message)||e));persist();renderPdocs();continue}
    if(!dc.content){ // 交给服务端解析正文（docx/txt 类支持；pdf 等不支持时静默跳过，仍可下载原件）
      try{
        const ex=await fetch('/api/chat/extract',{method:'POST',headers:{'content-type':'application/octet-stream','x-filename':encodeURIComponent(f.name)},body:f});
        const ej=await ex.json().catch(()=>({}));
        if(ex.ok&&ej.ok&&ej.text)dc.content=String(ej.text).slice(0,50000);
      }catch(_){}
    }
    persist();renderPdocs();
  }
  toast(files.length?('已上传入库（'+files.length+' 个文件）'):'未选择文件');
}
function pdOpenAdd(){pdafName.value='';pdafNote.value='';pdafDate.value=today();openMask('mPdAdd')}
function pdAddConfirm(){
  if(!pdafName.value.trim()){toast('请填写文档名称');return}
  const d=pdOf(pdPid);
  pdTargetList(d).push({id:uid(),name:pdafName.value.trim(),kind:'记录',size:0,date:pdafDate.value||today(),from:'登记',note:pdafNote.value.trim(),content:''});
  persist();closeMask('mPdAdd');renderPdocs();toast('已登记');
}
function pdView(id){const r=pdFind(id);if(!r)return;const dc=r.list[r.i];
  document.getElementById('docViewTitle').textContent=dc.name+'（'+dc.date+'）';
  document.getElementById('docViewBody').innerHTML=dc.content;openMask('mDocView')}
function pdDel(id){const r=pdFind(id);if(!r)return;const dc=r.list[r.i];
  if(!confirm(dc&&dc.fileId?'删除该文档记录？其已入库的原件会一并删除':'删除该文档记录？'))return;
  if(dc&&dc.fileId)fetch('/api/files/'+encodeURIComponent(dc.fileId),{method:'DELETE'}).catch(()=>{});
  r.list.splice(r.i,1);persist();renderPdocs()}
function pdMove(id){const r=pdFind(id);if(!r)return;
  pdPending={kind:'move',id,pid:pdPid};
  document.getElementById('pdmTitle').textContent='移动文档：'+r.list[r.i].name;
  pdmTab.value='process';pdafFillFolders();openMask('mPdMove');
}
function pdafFillFolders(){
  const d=pdOf(pdPending&&pdPending.pid?pdPending.pid:(pdPid||store.projects[0].id));
  pdmFolder.innerHTML='<option value="root">📂 未分类（过程根目录）</option>'+(d?d.process.folders.map(f=>`<option value="${f.id}">📁 ${esc(f.name)}</option>`).join(''):'');
  pdmFolder.style.display=pdmTab.value==='process'?'':'none';
}
function pdmFolders(){pdmFolder.style.display=pdmTab.value==='process'?'':'none'}
function pdmConfirm(){
  if(!pdPending)return;
  const tab=pdmTab.value,folder=pdmTab.value==='process'?pdmFolder.value:'root';
  const d=pdOf(pdPending.pid||pdPid);
  const tgt=tab==='process'?(folder==='root'?d.process.docs:((d.process.folders.find(f=>f.id===folder)||d.process).docs)):d[tab];
  if(pdPending.kind==='move'){
    const r=pdFind(pdPending.id);if(!r){closeMask('mPdMove');return}
    const dc=r.list.splice(r.i,1)[0];
    if(pdmNote.value.trim())dc.note=pdmNote.value.trim();
    tgt.push(dc);
  }else{
    tgt.push({id:uid(),name:pdPending.name,kind:'DOC',size:0,date:today(),from:'方案中心',note:pdmNote.value.trim()||'由方案制作中心收纳',content:pdPending.content});
  }
  persist();closeMask('mPdMove');
  pdPid=d?pdPid:pdPid;pdTab=tab;pdFolder=folder;
  renderPdocs();toast('已归档到项目文档 · '+PD_TABS[tab][0]);
}
function pdAddFolder(){const name=prompt('新建目录名称：');if(!name||!name.trim())return;pdOf(pdPid).process.folders.push({id:uid(),name:name.trim(),docs:[]});persist();renderPdocs()}
function pdRenFolder(id){const f=pdOf(pdPid).process.folders.find(x=>x.id===id);const name=prompt('重命名目录：',f.name);if(!name||!name.trim())return;f.name=name.trim();persist();renderPdocs()}
function pdDelFolder(id){const d=pdOf(pdPid);const f=d.process.folders.find(x=>x.id===id);if(!confirm(`删除目录「${f.name}」？其中 ${f.docs.length} 个文档将移回未分类`))return;d.process.docs.push(...f.docs);d.process.folders=d.process.folders.filter(x=>x.id!==id);if(pdFolder===id)pdFolder='root';persist();renderPdocs()}
function pdFromTask(id){
  const t=getTask(id);if(!t)return;
  const pv=document.getElementById('docPreview');if(pv)t.draft=pv.innerHTML;
  if(!t.draft){toast('请先生成初稿');return}
  const p=getProj(t.projectId);
  pdPending={kind:'draft',pid:t.projectId,name:`${DOC_TYPES[t.type].name}·${today()}.doc`,content:t.draft};
  document.getElementById('pdmTitle').textContent='收纳到项目文档：'+p.name;
  pdmTab.value='process';pdmNote.value='';
  const d=pdOf(t.projectId);
  pdmFolder.innerHTML='<option value="root">📂 未分类（过程根目录）</option>'+d.process.folders.map(f=>`<option value="${f.id}">📁 ${esc(f.name)}</option>`).join('');
  pdmFolders();openMask('mPdMove');
}

/* ================= 方案制作中心（对话式任务引擎） ================= */
const DOC_TYPES={
  first:{name:'首次售前交流 PPT',desc:'客户首次拜访/交流，讲清"懂客户、有价值、可信任"',icon:'🎤',expert:'售前交流专家',emo:'🎙️',agent:'调用 pptx 技能，生成首次交流演示文稿'},
  tech:{name:'技术方案 PPT',desc:'深度技术交流：需求理解、总体架构、关键设计',icon:'🏗️',expert:'技术方案专家',emo:'🛠️',agent:'调用 pptx 技能，生成技术交流方案演示文稿'},
  bidword:{name:'投标 Word 方案',desc:'技术标完整文档：响应、实施、管理、售后',icon:'📄',expert:'标书编制专家',emo:'⚖️',agent:'调用 docx 技能，生成完整投标技术方案 Word 文档'},
  bidppt:{name:'投标述标 PPT',desc:'述标/答辩演示：亮点浓缩 + Q&A 预案',icon:'🏆',expert:'述标答辩专家',emo:'🏅',agent:'调用 pptx 技能，生成述标演示文稿与答辩口径卡'},
  other:{name:'其他任务',desc:'过程杂项：会议纪要、询价比价、补材料、临时交办…',icon:'📌',expert:'通用事务助手',emo:'🧩',agent:'按任务要求处理该项事务，输出明确交付物'}};
const FORM_FIELDS={
  first:[['theme','交流主题','如：XX客户数字化转型整体思路'],['pain','客户痛点/关注点','来自背景收集表'],['value','我方核心价值主张','一句话：为什么选我们'],['case','拟讲同类案例','案例名称或留空自动生成'],['ask','希望客户达成的共识/下一步','如：联合调研、参观考察']],
  tech:[['req','需求理解要点','客户业务/技术需求'],['arch','总体架构思路','分层/模块描述'],['keys','关键技术设计点','3-5个技术亮点'],['deploy','部署与安全要求','云/本地、等保等'],['plan','实施计划概述','里程碑']],
  bidword:[['resp','招标核心要求','逐条列出或粘贴招标范围'],['adv','我方针对性优势','对应评分点'],['team','项目团队配置','项目经理/架构师等人数'],['mile','工期与里程碑','如：合同签订后90天上线'],['svc','售后服务承诺','SLA、驻场、巡检']],
  bidppt:[['score','评分办法要点','技术分占比、答辩要求'],['top3','最打动评委的3个亮点','分号分隔'],['time','述标时长','如：15分钟'],['qa','预判评委问题','常见问题']],
  other:[['topic','任务事项','要处理什么事？如：整理客户答疑纪要'],['why','背景与目的','为什么做、给谁看'],['due','时间要求','截止/交付时间'],['want','期望交付物','如：纪要文档、对比表、清单','']]};
/* 创建任务时自动从项目背景带入的字段映射 */
const BG_MAP={first:{pain:'why',theme:null},tech:{req:'why',deploy:'buy'},bidword:{resp:'buy',adv:'swot'},bidppt:{score:'buy',qa:'rival'}};
let curTaskId=null,CUR_A={},docMode='chat';
function getTask(id){return (store.tasks||[]).find(t=>t.id===id)}
function pn(){const p=getProj(document.getElementById('docProj').value);return p?{name:p.name,cust:p.customer}:{name:'XX项目',cust:'XX客户'}}
function fv(k){return (CUR_A&&String(CUR_A[k]||'')).trim()}

function renderDocsPage(){
  const sel=document.getElementById('docProj');
  const prev=sel.value||(curTaskId&&getTask(curTaskId)?getTask(curTaskId).projectId:'')||currentProjectId||'';
  sel.innerHTML='<option value="">— 请选择项目 —</option>'+store.projects.filter(p=>!['已中标','已流标','已输标'].includes(p.stage)).map(p=>`<option value="${p.id}">${esc(p.name)}（${esc(p.customer)}）</option>`).join('');
  if(prev&&store.projects.some(p=>p.id===prev))sel.value=prev;
  renderTypeCards();renderTaskList();renderRightPanel();
}
function onDocProjChange(){renderTaskList();curTaskId=null;docMode='chat';docView='list';renderTypeCards();renderRightPanel()}
function renderTypeCards(){
  document.getElementById('docTypes').innerHTML=Object.entries(DOC_TYPES).map(([k,v])=>{
    const n=(store.tasks||[]).filter(t=>t.type===k&&(!document.getElementById('docProj').value||t.projectId===document.getElementById('docProj').value)).length;
    return `<div class="dtype ${k===curType?'on':''}" onclick="selectDocType('${k}')"><span class="dico">${v.icon}</span><div style="flex:1"><b>${v.name}</b><span>${v.desc} · 专家：${v.expert}</span></div><span class="tag">${n} 对话</span></div>`}).join('');
}
function selectDocType(type){curType=type;curTaskId=null;docView='list';renderTypeCards();renderRightPanel()}
function renderTaskList(){
  const pid=document.getElementById('docProj').value;
  const list=(store.tasks||[]).filter(t=>!pid||t.projectId===pid);
  const el=document.getElementById('taskList');
  if(!el)return;
  el.innerHTML=list.length?list.map(t=>{
    const stName={chat:'对话中',ready:'待生成',draft:'已有初稿'}[t.status];
    return `<div class="trow ${t.id===curTaskId?'on':''}" onclick="openTask('${t.id}')"><span class="dico" style="font-size:18px">${DOC_TYPES[t.type].icon}</span>
      <div class="tt"><b>${DOC_TYPES[t.type].name}</b><small>${esc((getProj(t.projectId)||{}).name||'')} · ${esc(t.created)}</small></div>
      <span class="st ${t.status}">${stName}</span>
      <button class="btn sm danger" onclick="event.stopPropagation();delTask('${t.id}')">✕</button></div>`}).join('')
    :'<div class="empty">暂无任务，点击②中任一文档类型创建</div>';
}
function createDocTask(type){
  const pid=document.getElementById('docProj').value;
  if(!pid){toast('请先在①关联项目');return}
  store.tasks=store.tasks||[];
  const p=getProj(pid);
  const t={id:uid(),projectId:pid,type,title:DOC_TYPES[type].name+' · 新对话',status:'chat',msgs:[],answers:{},qIndex:0,created:today(),ts:Date.now(),draft:null};
  store.tasks.unshift(t);addTl(p,'创建任务：'+t.title);persist();
  curTaskId=t.id;curType=type;docMode='chat';docView='task';
  const D=DOC_TYPES[type];const BM=BG_MAP[type]||{};
  const imported=[];
  FORM_FIELDS[type].forEach(f=>{const bk=BM[f[0]];if(bk&&p.bg&&p.bg[bk]){t.answers['__bg_'+f[0]]=p.bg[bk];imported.push(f[1])}});
  say(t,'ai',`您好！我是「${D.expert}」${D.emo}，本次任务由我协助您完成${type==='other'?'这项事务：':'《'+D.name+'》编制：'}\n项目：${p.name}\n客户：${p.customer} · 阶段：${p.stage} · C139 赢单率 ${c139Stats(p.c139).rate}%`);
  if(imported.length)say(t,'ai',`我已从项目背景收集表自动带入：${imported.join('、')}。每到一问，您可直接采用带入内容、修改后发送，或让我用模板默认值。`);
  else say(t,'ai',`接下来我将逐题向您收集关键要素，每题可直接输入、用快捷选项，或让我用模板默认值兜底。`);
  askNext(t);
  renderTaskList();renderTypeCards();renderRightPanel();toast('任务已创建');
}
function openTask(id){curTaskId=id;const t=getTask(id);if(t)curType=t.type;docView='task';docMode=t&&t.status==='draft'?'edit':'chat';renderTaskList();renderRightPanel()}
function delTask(id){if(!confirm('删除该任务？'))return;store.tasks=store.tasks.filter(t=>t.id!==id);if(curTaskId===id){curTaskId=null;docView='list'}persist();renderTaskList();renderTypeCards();refreshQwRows();renderRightPanel()}
function say(t,role,text){t.msgs.push({role,text,ts:Date.now()});persist()}
function curQ(t){return FORM_FIELDS[t.type][t.qIndex]}
function askNext(t){
  const q=curQ(t);
  if(!q){finishQuestions(t);return}
  const bgv=t.answers['__bg_'+q[0]];
  let msg=`【第${t.qIndex+1}/${FORM_FIELDS[t.type].length}问 · ${q[1]}】`;
  if(q[2])msg+=`\n提示：${q[2]}`;
  if(bgv)msg+=`\n\n我已从项目背景带入：\n「${String(bgv).slice(0,120)}${String(bgv).length>120?'…':''}」\n可直接点击「采用带入背景」，或输入您的补充/修改。`;
  else msg+=`\n请输入内容，或点击下方快捷选项。`;
  say(t,'ai',msg);
}
function answer(t,val){
  const q=curQ(t);if(!q)return;
  say(t,'me',val&&val.trim()?val.trim():'（跳过，用模板默认）');
  if(val&&val.trim()){
    t.answers[q[0]]=val.trim();
    if(!t.autoTitle){t.title=val.trim().replace(/\s+/g,' ').slice(0,24);t.autoTitle=true;renderTypeCards();refreshQwRows()}
  }
  t.qIndex++;
  say(t,'ai',val&&val.trim()?'收到 ✓':'好的，这一项我先用专业模板默认值兜底，初稿中会标注【待确认】。');
  askNext(t);renderRightPanel();renderTaskList();
}
function answerFromBg(t){const q=curQ(t);if(!q)return;answer(t,t.answers['__bg_'+q[0]])}
function skipQ(t){answer(t,'')}
function finishQuestions(t){
  t.status='ready';
  let sum=FORM_FIELDS[t.type].map(q=>`${q[1]}：${t.answers[q[0]]?'已收集':'模板默认'}`).join('\n');
  say(t,'ai',`所有关键要素收集完毕！\n${sum}\n\n我现在就可以生成初稿。生成后您可继续编辑、导出，或复制「Agent 任务提示词」交给千问办公的专家智能体产出成品。`);
  renderRightPanel();renderTaskList();
}
function genDraft(t){
  const p=getProj(t.projectId);CUR_A=t.answers;
  let h=t.type==='first'?tplFirst(p.name,p.customer):t.type==='tech'?tplTech(p.name,p.customer):t.type==='bidword'?tplBidWord(p.name,p.customer):t.type==='bidppt'?tplBidPpt(p.name,p.customer):tplOther(p.name,p.customer);
  t.draft=h;t.status='draft';
  say(t,'ai','📄 初稿已生成，已切换到编辑器。可直接修改文字，右侧按钮可导出 Word / Markdown / 大纲，或存档到项目。');
  docMode='edit';persist();renderTaskList();renderRightPanel();
}
/* ---- 右侧面板：对话 / 编辑器 ---- */
let docView='list',curType=null,qwFs='all',qwFsrc='all',qwFkw='';
function rel(ts){
  if(!ts)return '—';
  const d=Date.now()-ts;
  if(d<6e4)return '刚刚';if(d<36e5)return Math.floor(d/6e4)+' 分钟前';
  if(d<864e5)return Math.floor(d/36e5)+' 小时前';if(d<1728e5)return '昨天';
  return new Date(ts).toLocaleDateString('zh-CN');
}
function renderRightPanel(){
  const el=document.getElementById('docRight');
  const t=curTaskId?getTask(curTaskId):null;
  if(!t||docView==='list'){el.innerHTML=qwListHtml();return}
  const D=DOC_TYPES[t.type];const p=getProj(t.projectId)||{name:'—'};
  const head=`<div class="chat-head"><button class="btn sm ghost" onclick="docView='list';renderRightPanel()">← 任务</button>
    <div class="avatar">${D.emo}</div>
    <div style="flex:1"><b>${esc(t.title||D.name)}</b><small>${D.expert} · ${D.name} ｜ ${esc(p.name)} · ${rel(t.ts)} · <span class="st ${t.status}">${{chat:'对话中',ready:'待生成',draft:'已有初稿'}[t.status]}</span></small></div>
    <button class="btn sm ghost" onclick="docMode='chat';renderRightPanel()">💬 对话</button>
    ${t.draft?`<button class="btn sm ghost" onclick="docMode='edit';renderRightPanel()">📝 编辑初稿</button>`:''}
    <button class="btn sm" onclick="copyAgentPrompt('${t.id}')">🤖 Agent提示词</button></div>`;
  el.innerHTML=head+`<div style="flex:1;display:flex;flex-direction:column">`+(docMode==='edit'&&t.draft?editorHtml(t):chatBodyHtml(t)+qwInputBar(t))+`</div>`;
  const body=el.querySelector('.chat-body');if(body&&docMode==='chat')body.scrollTop=body.scrollHeight;
}
function qwListHtml(){
  const D=curType?DOC_TYPES[curType]:null;
  return `<div style="display:flex;align-items:flex-end;gap:12px;border-bottom:2px solid var(--line);margin-bottom:12px">
    <h2 style="font-size:17px;display:inline-block;padding:0 14px 10px;border-bottom:2px solid var(--brand);color:var(--brand);font-weight:800">任务</h2>
    <div style="padding-bottom:10px;font-size:12.5px;color:var(--sub)">${D?`${D.icon} ${D.name} · ${D.expert} 的历次对话（标题按对话内容自动生成）`:'请先在左侧 ② 点击一个文档类型，查看其历次对话任务'}</div>
    <div style="flex:1"></div>
    <button class="btn sm" style="margin-bottom:8px" ${D?`onclick="createDocTask('${curType}')"`:'disabled'}>＋ 发起新对话</button></div>
  <div class="qw-filters">
    <select onchange="qwFs=this.value;refreshQwRows()">
      <option value="all" ${qwFs==='all'?'selected':''}>全部任务</option>
      <option value="chat" ${qwFs==='chat'?'selected':''}>对话中</option>
      <option value="ready" ${qwFs==='ready'?'selected':''}>待生成</option>
      <option value="draft" ${qwFs==='draft'?'selected':''}>已有初稿</option></select>
    <select onchange="qwFsrc=this.value;refreshQwRows()">
      <option value="all" ${qwFsrc==='all'?'selected':''}>全部来源</option>
      <option value="local" ${qwFsrc==='local'?'selected':''}>本地专家</option>
      <option value="agent" ${qwFsrc==='agent'?'selected':''}>已接入Agent</option></select>
    <span style="color:var(--sub);font-size:12px">你的任务是私密的，除非你共享它们</span>
    <div style="flex:1"></div>
    <input placeholder="🔍 搜索任务标题" style="width:200px" value="${esc(qwFkw)}" oninput="qwFkw=this.value.toLowerCase();refreshQwRows()">
  </div>
  <div class="qw-list" id="qwList">${qwRows()}</div>
  ${qwInputBar(null)}`;
}
function refreshQwRows(){const el=document.getElementById('qwList');if(el)el.innerHTML=qwRows()}
function qwRows(){
  const pid=document.getElementById('docProj').value;
  let list=(store.tasks||[]).filter(t=>!pid||t.projectId===pid);
  if(curType)list=list.filter(t=>t.type===curType);
  if(qwFs!=='all')list=list.filter(t=>t.status===qwFs);
  if(qwFsrc==='local')list=list.filter(t=>!t.copied);
  if(qwFsrc==='agent')list=list.filter(t=>t.copied);
  if(qwFkw)list=list.filter(t=>{const p=getProj(t.projectId)||{name:''};return (String(t.title)+DOC_TYPES[t.type].name+p.name).toLowerCase().includes(qwFkw)});
  if(!list.length)return `<div class="empty">${curType?`「${DOC_TYPES[curType].name}」还没有对话任务 —— 点右上角「＋ 发起新对话」开始`:'请先在左侧 ② 点击一个文档类型'}</div>`;
  return list.map(t=>{
    const p=getProj(t.projectId)||{name:''};
    return `<div class="qw-task" onclick="openTaskQw('${t.id}')">
    <span class="qw-ico">💬</span>
    <span class="qw-title">${esc(t.title||DOC_TYPES[t.type].name)} · ${esc(p.name)}</span>
    <span class="qw-dot ${t.status}" title="${{chat:'对话中',ready:'待生成',draft:'已有初稿'}[t.status]}"></span>
    <span class="qw-tag">${t.copied?'已接入Agent':'本地'}</span>
    <span class="qw-time">${rel(t.ts)}</span>
    <span class="qw-more" onclick="event.stopPropagation();qwMenu('${t.id}')">⋯</span>
    <span class="qw-menu" id="menu-${t.id}" style="display:none">
      <button onclick="event.stopPropagation();openTaskQw('${t.id}')">💬 打开对话</button>
      ${t.draft?`<button onclick="event.stopPropagation();openTaskQw('${t.id}');docMode='edit';renderRightPanel()">📝 编辑初稿</button>`:''}
      <button onclick="event.stopPropagation();copyAgentPrompt('${t.id}')">🤖 复制Agent提示词</button>
      <button style="color:var(--bad)" onclick="event.stopPropagation();delTask('${t.id}')">🗑️ 删除任务</button>
    </span></div>`}).join('');
}
function qwMenu(id){
  document.querySelectorAll('.qw-menu').forEach(m=>{if(m.id!=='menu-'+id)m.style.display='none'});
  const m=document.getElementById('menu-'+id);if(m)m.style.display=m.style.display==='none'?'flex':'none';
}
document.addEventListener('click',()=>{document.querySelectorAll('.qw-menu').forEach(m=>m.style.display='none')});
function openTaskQw(id){curTaskId=id;const t=getTask(id);if(!t)return;curType=t.type;docView='task';docMode=t.status==='draft'?'edit':'chat';renderTaskList();renderRightPanel()}
function chatBodyHtml(t){
  const D=DOC_TYPES[t.type];
  let h='<div class="chat-body">';
  t.msgs.forEach(m=>{h+=`<div class="msg ${m.role}"><div class="m-av">${m.role==='ai'?D.emo:'🧑'}</div><div class="bubble">${esc(m.text)}</div></div>`});
  if(t.status==='ready')h+=`<div class="gen-card">✅ 要素已齐备 —— <button class="btn sm" onclick="genDraft(getTask('${t.id}'))">⚡ 立即生成初稿</button></div>`;
  h+='</div>';
  const q=curQ(t);
  if(q){
    h+='<div class="chips">';
    if(t.answers['__bg_'+q[0]])h+=`<span class="chip" onclick="answerFromBg(getTask('${t.id}'))">✨ 采用带入背景：${esc(String(t.answers['__bg_'+q[0]]).slice(0,26))}…</span>`;
    h+=`<span class="chip" onclick="skipQ(getTask('${t.id}'))">⏭️ 跳过，用模板默认</span>`;
    h+=`<span class="chip" onclick="pickKbForAnswer('${t.id}')">📚 @知识库素材</span></div>`;
  }
  return h;
}
function qwInputBar(t){
  const waiting=t&&t.status==='chat'&&curQ(t);
  const active=!!t&&docMode==='chat';
  const ph=t?(waiting?`今天帮你做些什么？回复「${DOC_TYPES[t.type].expert}」：${curQ(t)[1]}…（回车发送）`:'继续补充信息（修改意见、追加亮点…），回车发送给专家'):'今天帮你做些什么？ @ 引用资产文件、项目待办或调用技能';
  return `<div class="qw-input">
    <input id="chatIn" ${active?'':'disabled'} placeholder="${esc(ph)}" ${active?`onkeydown="if(event.key==='Enter')sendChat('${t.id}')"`:''}>
    <div class="qi-bar">
      <span class="qi-ico" title="引用知识库素材" onclick="${active?`pickKbForAnswer('${t.id}')`:'toast(\'请先创建/打开任务\')'}">＋</span>
      <div style="flex:1"></div>
      <span class="qi-auto" onclick="toast('当前为内置专家模式；接入外部 Agent 请点「🤖 Agent提示词」')">🌐 Auto </span>
      <span class="qi-ico" title="语音输入（原型占位）" onclick="toast('语音输入为界面占位，原型暂不支持')">🎤</span>
      <button class="qi-send" title="发送" onclick="${active?`sendChat('${t.id}')`:'toast(\'请先创建/打开任务\')'}">➤</button>
    </div></div>`;
}
function sendChat(id){const inp=document.getElementById('chatIn');const t=getTask(id);if(!inp||!t)return;const v=inp.value;inp.value='';if(!v.trim())return;
  if(curQ(t))answer(t,v);else followUp(t,v)}
function followUp(t,val){
  say(t,'me',val);
  t.extra=t.extra||[];t.extra.push(val);
  say(t,'ai','收到补充信息，已记录 ✓\n· 若已有初稿：可在编辑器直接修改，或点「♻️ 按最新回答重新生成」\n· 「🤖 Agent提示词」会包含全部补充信息，交给千问办公专家时一并生效');
  persist();renderRightPanel();
}
function pickKbForAnswer(id){
  curTaskId=id;renderInsertList();
  document.getElementById('insList').dataset.target='chat';
  document.getElementById('insList').dataset.task=id;
  openMask('mInsert');
}
function editorHtml(t){
  return `<div style="flex:1;display:flex;flex-direction:column">
    <div id="docPreview" contenteditable="true" style="flex:1;max-height:none">${t.draft}</div>
    <div class="doc-actions">
      <button class="btn sm" onclick="exportTaskDoc('doc','${t.id}')">导出 Word（.doc）</button>
      <button class="btn sm ghost" onclick="exportTaskDoc('md','${t.id}')">导出 Markdown</button>
      <button class="btn sm ghost" onclick="exportTaskDoc('txt','${t.id}')">导出纯文本/大纲</button>
      <button class="btn sm ghost" onclick="copyDoc()">📋 复制全文</button>
      <button class="btn sm ghost" onclick="insertKb()">📚 插入知识库素材</button>
      <button class="btn sm ok" onclick="saveDocToProject('${t.id}')">💾 存档到项目</button>
      <button class="btn sm ghost" onclick="pdFromTask('${t.id}')">🗂️ 收纳到项目文档</button>
      <button class="btn sm ghost" onclick="genDraft(getTask('${t.id}'))">♻️ 按最新回答重新生成</button>
    </div></div>`;
}
/* ---- 接入千问办公 Agent 专家 ---- */
function buildAgentPrompt(t){
  const p=getProj(t.projectId);const D=DOC_TYPES[t.type];const s=c139Stats(p.c139);
  let q=`【角色】你是${D.expert}，${t.type==='other'?'请为项目处理以下事务型任务：'+(t.answers.topic||t.title):'请为项目编制《'+D.name+'》'}。${D.agent}。\n\n`;
  const am=amountsOf(p);
  q+=`【项目概况】\n项目名称：${p.name}\n客户：${p.customer}\n预估合同额：${am.est||'—'} 万元${am.sw?'（其中软件 '+am.sw+' 万元）':''} · 阶段：${p.stage} · C139赢单率：${s.rate}%（${s.zone==='win'?'赢单区':s.zone==='mid'?'抖动区':'输单区'}）\n\n`;
  if(p.progressText)q+=`【当前进展】\n${p.progressText}\n\n`;
  q+=`【项目背景】\n`;
  let any=false;BG_FIELDS.forEach(f=>{if(p.bg&&p.bg[f[0]]){q+=`- ${f[1]}：${p.bg[f[0]]}\n`;any=true}});
  if(!any)q+='- （背景收集表为空，请先补充）\n';
  q+=`\n【对话收集的关键要素】\n`;
  FORM_FIELDS[t.type].forEach(f=>{q+=`- ${f[1]}：${t.answers[f[0]]||'（未提供，请用专业默认并标注【待确认】）'}\n`});
  if(t.extra&&t.extra.length){q+=`\n【补充信息（对话追加）】\n`;t.extra.forEach(e=>{q+=`- ${e}\n`})}
  q+=`\n【输出要求】\n`;
  if(t.type==='bidword')q+=`- 七章结构：项目理解与需求分析 / 总体设计 / 详细技术方案 / 实施方案 / 售后服务 / 公司实力与案例 / 附件索引\n- 所有★号条款逐条正偏离响应；【】处需人工核对招标文件原文\n- 输出为 .docx，正文宋体小四、标题层级规范\n`;
  else if(t.type==='other')q+=`- 这是项目过程中的事务型任务：直接产出期望交付物（纪要/对比表/清单/文档草稿）\n- 明确截止时间与责任人；无法确定处标注【待确认】\n- 交付物为文件时按合适格式输出（.docx/.xlsx/.md）\n`;
  else q+=`- 逐页输出：页码、标题、3-5条要点、讲稿提示\n- 封面含项目名与客户名；页数控制在 ${t.type==='bidppt'?'8-10':'10-14'} 页\n- 生成 .pptx 文件\n`;
  q+=`\n【风格】用客户的语言描述价值；数据与案例可引用知识库素材：\n`;
  const kw=(p.customer+p.name).slice(0,4);
  store.kb.filter(k=>k.title.includes(kw)||k.content.includes(kw)).slice(0,3).forEach(k=>{q+=`- 《${k.title}》：${k.content.slice(0,100)}…\n`});
  if(!store.kb.length)q+='- （知识库暂无匹配素材）';
  return q;
}
function copyAgentPrompt(id){
  const t=getTask(id);if(!t)return;
  const txt=buildAgentPrompt(t);
  const done=()=>{t.copied=true;persist();refreshQwRows();renderTaskList();toast('提示词已复制：新建千问办公任务并粘贴，即可由对应专家智能体生成成品')};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(txt).then(done,()=>fallbackCopy(txt,done));
  else fallbackCopy(txt,done);
}
function fallbackCopy(txt,done){const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');done()}catch(e){toast('复制失败，请手动选择文本')}document.body.removeChild(ta)}
function slide(n,title,bullets,note){
  return `<h2>第${n}页｜${title}</h2>${bullets.map(b=>'• '+b).join('\n')}${note?`\n<span style="color:#8a93a8;font-size:12px"> 讲稿提示：${note}</span>`:''}\n\n`;}
function tplFirst(n,c){
  const pain=fv('pain')||`${c}当前业务痛点（交流前务必填入背景收集表：效率/成本/合规/增长等）`;
  const val=fv('value')||'懂行业、有同类成功案例、方案可落地、服务有保障';
  const cs=fv('case')||'选 1-2 个同行业标杆案例：客户背景 → 痛点 → 方案 → 量化成效';
  const ask=fv('ask')||'约定联合需求调研时间，并邀请客户参观已上线项目现场';
  let h=`<h1>${n} · 首次售前交流方案</h1><div style="color:var(--sub)">汇报对象：${c}相关处室 · 建议时长 40 分钟 · 生成于 ${today()}</div>\n\n`;
  h+=slide(1,`封面：${n}整体解决方案交流`,[`${c} 售前团队`,'日期 / 主讲人']);
  h+=slide(2,'目录',['我们如何理解贵单位','痛点与机会分析','总体解决思路','核心能力与案例','合作模式与下一步']);
  h+=slide(3,'一、我们理解的'+c,[ '行业/政策背景下的形势与要求','贵单位业务现状与已有信息化基础','本次项目在其整体规划中的位置'],'体现"做过功课"，此页内容全部来自背景收集表，让客户点头');
  h+=slide(4,'二、痛点与机会分析',[pain,'痛点背后的业务影响（量化：效率↓、成本↑、风险↑）','同行已验证的改进机会'],'用客户的语言描述痛点，不急于讲产品');
  h+=slide(5,'三、总体解决思路',['一张总体蓝图（业务视角，非产品堆砌）','近期见效的切入点 + 中长期演进路径','与我方产品/服务的对应关系']);
  h+=slide(6,'四、核心能力与优势',[val,'关键能力 1：…','关键能力 2：…','关键能力 3：…'],'只讲与本次痛点强相关的能力，避免全家桶');
  h+=slide(7,'五、同类成功案例',[cs,'案例讲解结构：背景→挑战→方案→量化成效→客户评价'],'案例是首次交流建立信任的核心弹药');
  h+=slide(8,'六、公司实力与服务保障',['资质与荣誉','本地化服务团队','服务承诺 SLA']);
  h+=slide(9,'七、合作模式与下一步',[ask,'可选合作路径：咨询规划 / 试点先行 / 整体建设'],'首次交流成功的标志：约定了明确的下一步动作');
  h+=slide(10,'结束页',['感谢 · 联系方式 · 答疑'],'留 10 分钟倾听客户反馈，记录关键人态度');
  return h;
}
function tplTech(n,c){
  const req=fv('req')||'（从背景收集表带入：业务需求 / 功能需求 / 性能与集成需求）';
  let h=`<h1>${n} · 技术方案</h1><div style="color:var(--sub)">${c} · 技术交流版 · ${today()}</div>\n\n`;
  h+=slide(1,'封面',[`${n}技术方案`,'我方名称 / 日期']);
  h+=slide(2,'目录',['需求理解','总体设计','关键技术方案','部署与安全','实施计划','运维与案例']);
  h+=slide(3,'一、需求理解',[req,'需求映射表：客户需求 ↔ 我方功能模块 ↔ 满足度(★)','对模糊需求的确认清单'],'先证明"我们准确理解了需求"');
  h+=slide(4,'二、总体设计',['总体架构图（接入层/应用层/数据层/基础设施）','技术路线图','与现有系统的集成关系'],'一页图讲清整体，再逐层展开');
  h+=slide(5,'三、关键技术方案',[fv('keys')||'1. 核心业务流程设计\n2. 数据模型与治理方案\n3. 接口与集成方案\n4. 性能与高可用设计']);
  h+=slide(6,'四、部署与安全方案',[fv('deploy')||'部署架构（云/本地/混合）','等保/密评合规设计','备份容灾']);
  h+=slide(7,'五、实施计划',[fv('plan')||'里程碑：调研设计→开发配置→测试→试运行→验收','团队与分工','风险与应对']);
  h+=slide(8,'六、运维服务',[ '服务目录与SLA','驻场/远程支持','知识转移与培训']);
  h+=slide(9,'七、同类项目案例',[ '案例1：规模、成效、现场照片','案例2：…']);
  h+=slide(10,'技术答疑准备',['预判客户技术质疑点及应答口径']);
  return h;
}
function tplBidWord(n,c){
  const resp=fv('resp')||'【请将招标文件"采购需求"章节逐条粘贴至此，形成需求响应对照表的基础】';
  let h=`<h1>${n} 投标文件 · 技术方案</h1><div style="color:var(--sub)">（${c}）· ${today()} · 本稿为章节骨架+核心内容初稿，【】内为必须人工核对项</div>\n\n`;
  h+=`<h2>第一章 项目理解与需求分析</h2>
1.1 项目背景：${c}本次建设是落实【政策/规划依据】、解决【核心业务痛点】的重要举措。
1.2 建设目标：【用招标文件的原话表述目标，体现逐字研读】
1.3 需求理解与响应偏离表：\n${resp}\n（建议做成表格：招标要求 | 我方响应 | 偏离情况 | 证明材料索引）
1.4 项目重点难点分析：【3-5条，每条给出我方应对思路——这是拉开评分差距的关键章节】\n\n`;
  h+=`<h2>第二章 总体设计方案</h2>
2.1 设计原则与依据　2.2 总体架构（业务/应用/数据/技术架构+图）　2.3 功能设计与招标功能清单逐项对应　2.4 关键技术与创新点：${fv('adv')||'【对应评分标准中的加分项逐条展开】'}\n\n`;
  h+=`<h2>第三章 详细技术方案</h2>
3.1 分系统/模块详细设计　3.2 接口与数据方案　3.3 部署方案　3.4 安全与等保设计　3.5 性能指标与测算依据【所有★号条款必须逐条正偏离响应并给出证明材料编号】\n\n`;
  h+=`<h2>第四章 项目实施方案</h2>
4.1 实施策略与组织：项目团队配置——${fv('team')||'项目经理1名（【附证书/履历】）、技术负责人1名、实施工程师N名'}
4.2 进度计划与里程碑：${fv('mile')||'合同签订后【N】日历天完成部署上线；里程碑：需求确认→开发/配置→测试→试运行→初验→终验'}
4.3 质量保障体系　4.4 风险管理与应急预案　4.5 培训与知识转移　4.6 验收方案与标准\n\n`;
  h+=`<h2>第五章 售后服务方案</h2>
5.1 服务承诺：${fv('svc')||'7×24响应，30分钟响应/2小时到场/4小时修复（【以招标文件要求为准，不得低承诺】）'}
5.2 本地化服务资源　5.3 备品备件　5.4 质保期后服务安排\n\n`;
  h+=`<h2>第六章 公司实力与项目案例</h2>
6.1 公司概况与资质（【营业执照/资质证书/荣誉，对照评分表要求项逐一核对是否在有效期内】）
6.2 同类项目案例（【近3年、同规模、同行业优先，附合同关键页/验收报告索引】）\n\n`;
  h+=`<h2>第七章 附件与证明材料索引</h2>
【按招标文件规定的顺序编排：资质证书、业绩证明、人员证书、财务证明、缴纳社保纳税证明等——顺序错、缺项可能直接废标】`;
  return h;
}
function tplBidPpt(n,c){
  let h=`<h1>${n} · 述标演示</h1><div style="color:var(--sub)">建议 ${fv('time')||'15'} 分钟 · 评委=招标方代表+专家，重合规、重亮点、重信心</div>\n\n`;
  h+=slide(1,'开场（1分钟）',['公司介绍一页带过：资质、实力、本地服务','直接进入主题——评委已看过技术方案，述标讲"为什么选我们"']);
  h+=slide(2,'项目理解（2分钟）',['一句话复述采购需求核心','点出2-3个难点+我方破解思路'],'证明专业度，与标书保持一致');
  h+=slide(3,'方案总览（2分钟）',['总体架构一页图','功能覆盖度：100%响应，N项正偏离']);
  h+=slide(4,'核心亮点（4分钟）',(fv('top3')||'亮点一：…；亮点二：…；亮点三：…').split(/[；;]/).map(s=>s.trim()).filter(Boolean),'每个亮点=客户价值+证据（案例/数据/演示）');
  h+=slide(5,'实施保障（2分钟）',['团队亮相（真实投入承诺）','里程碑与按期交付保障']);
  h+=slide(6,'服务承诺（2分钟）',['SLA 承诺（不低于标书要求）','本地化资源展示']);
  h+=slide(7,'案例与信心（1分钟）',['同行业标杆案例 + 客户评价/现场照片']);
  h+=slide(8,'结束（1分钟）',['郑重承诺 + 感谢'],'预留联系方式与答疑');
  h+=slide(9,'附：Q&A 预案',[fv('qa')||'1. 工期如何保证？\n2. 与现有系统对接方案？\n3. 人员到位承诺？\n4. 售后响应如何考核？'],'每题准备30秒标准答案，指定答题人');
  return h;
}
function tplOther(n,c){
  const topic=fv('topic')||'（待明确的任务事项）';
  let h=`<h1>其他任务 · ${topic}</h1><div style="color:var(--sub)">${n}（${c}）· 创建日期：${today()} · 通用事务助手生成</div>\n\n`;
  h+=`<h2>一、任务事项</h2>\n${topic}\n\n`;
  h+=`<h2>二、背景与目的</h2>\n${fv('why')||'【待确认】为什么做、给谁看、与项目哪个环节相关'}\n\n`;
  h+=`<h2>三、时间与交付要求</h2>\n截止时间：${fv('due')||'【待确认】'}\n期望交付物：${fv('want')||'【待确认】'}\n\n`;
  h+=`<h2>四、建议行动步骤</h2>\n1. 确认需求边界与验收标准（找发起人核对）\n2. 收集所需信息与素材（优先查向量知识库 / 项目知识库）\n3. 起草交付物 → 内部核对 → 按截止时间提交\n4. 提交后将成果归档到「项目知识库 → 过程/输出」\n\n`;
  h+=`<h2>五、执行记录</h2>\n（在此持续登记进展）\n- ${today()}：任务创建\n`;
  return h;
}
/* ---- 导出 ---- */
function download(name,text,mime){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:mime}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
function exportTaskDoc(fmt,id){
  const t=getTask(id);if(!t)return;
  const pv=document.getElementById('docPreview');if(!pv){toast('请先生成初稿');return}
  t.draft=pv.innerHTML;persist();
  const p=getProj(t.projectId)||{name:'项目'};const name=p.name;const tn=DOC_TYPES[t.type].name;
  if(fmt==='md')download(`${name}-${tn}.md`,htmlToMd(pv.innerHTML),'text/markdown;charset=utf-8');
  if(fmt==='txt')download(`${name}-${tn}-大纲.txt`,pv.innerText,'text/plain;charset=utf-8');
  if(fmt==='doc'){
    const head='<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>body{font-family:宋体;font-size:12pt;line-height:1.8}h1{font-size:18pt;text-align:center}h2{font-size:14pt}</style></head><body>';
    download(`${name}-${tn}.doc`,'\ufeff'+head+pv.innerHTML+'</body></html>','application/msword');
  }
  toast('已导出，请查看下载目录');
}
function htmlToMd(h){return h.replace(/<h1>/g,'# ').replace(/<h2>/g,'\n## ').replace(/<\/h[12]>/g,'\n').replace(/<br\s*\/?>/g,'\n').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ')}
function copyDoc(){const pv=document.getElementById('docPreview');if(!pv){toast('请先生成初稿');return}navigator.clipboard.writeText(pv.innerText).then(()=>toast('已复制，可粘贴到 PPT 大纲视图 / Word'))}
function saveDocToProject(id){
  const t=getTask(id||curTaskId);if(!t){toast('请先打开任务');return}
  const pv=document.getElementById('docPreview');if(pv)t.draft=pv.innerHTML;
  if(!t.draft){toast('请先生成初稿');return}
  const p=getProj(t.projectId);p.docs=p.docs||[];
  store.docs.unshift({id:uid(),taskId:t.id,type:t.type,typeName:DOC_TYPES[t.type].name,title:`${p.name} - ${DOC_TYPES[t.type].name}`,html:t.draft,date:today(),projectId:t.projectId});
  addTl(p,'存档文档：'+DOC_TYPES[t.type].name);persist();toast('已存档到项目「本项目文档」');
}
/* ---- 插入知识库（编辑器 / 对话回答 双目标） ---- */
function insertKb(){
  document.getElementById('insList').dataset.target='editor';
  renderInsertList();openMask('mInsert');
}
function renderInsertList(){
  const kw=(document.getElementById('insSearch').value||'').toLowerCase().split(/\s+/).filter(Boolean);
  let list=store.kb;
  if(kw.length)list=list.map(k=>({k,s:kbScore(k,kw)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).map(x=>x.k);
  document.getElementById('insList').innerHTML=list.map(k=>`<div class="kb-item"><div style="display:flex;align-items:center;gap:8px">
    <b>${esc(k.title)}</b><span class="tag">📁 ${esc(catName(k.catId))}</span><div style="flex:1"></div>
    <button class="btn sm" onclick="doInsert('${k.id}')">插入 →</button></div>
    <div class="meta">${k.tags.map(t=>'#'+esc(t)).join(' ')}</div></div>`).join('')||'<div class="empty">无素材</div>';
}
function doInsert(id){
  const k=store.kb.find(x=>x.id===id);
  const box=document.getElementById('insList');
  closeMask('mInsert');
  if(box.dataset.target==='chat'){
    const inp=document.getElementById('chatIn');
    if(inp){inp.value=(inp.value?inp.value+'\n':'')+`【引用素材：${k.title}】${k.content.slice(0,300)}`;inp.focus();toast('素材已填入回答框，可编辑后发送');return}
  }
  const pv=document.getElementById('docPreview');
  if(!pv){toast('请先生成初稿后再插入素材');return}
  pv.innerHTML+=`\n<h2>【插入素材】${esc(k.title)}</h2>\n${esc(k.content)}\n`;
  const t=getTask(curTaskId);if(t)t.draft=pv.innerHTML;persist();
  toast('已插入到文档编辑器');
}

/* ================= C139 页面 ================= */
function renderC139(){
  const sel=document.getElementById('c139Proj');
  const prev=sel.value||currentProjectId;
  sel.innerHTML=store.projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')||'<option value="">暂无项目，请先创建</option>';
  if(prev&&store.projects.some(p=>p.id===prev))sel.value=prev;
  const p=getProj(sel.value);
  if(!p){document.getElementById('c139Score').innerHTML='<div class="sub">请先在项目管理中创建项目</div>';document.getElementById('c139Body').innerHTML='';return}
  const c=p.c139=c139Normalize(p.c139);
  const s=c139Stats(c);
  document.getElementById('c139Score').innerHTML=`
    <div class="sub">当前项目赢单率</div><div class="big">${s.rate}%</div>
    ${zoneBadge(s.zone)}
    <div style="margin:16px 0 4px;font-size:13px">1Win ${c.is1W?'✅':'❌'} ｜ *C教练 ${c.coach?'✅':'❌'} ｜ 共识 ${s.F}/3 ｜ 九要素 ${s.N}/9</div>
    <div class="sub" style="margin-top:10px;line-height:1.7">${esc(s.tip)}</div>
    <div style="margin-top:14px;font-size:11px;color:#8b95b8;text-align:left;line-height:1.8">
    区间规则：1W+3F+*C=100% ｜ 1W+2F+*C=99%<br>1W+1F+9C=91%，6-8C=85%<br>1W+1F+5C=50%（制胜拐点）<br>0W+2F+6C=26%（死亡拐点）</div>`;
  document.getElementById('c139Body').innerHTML=`
    <div class="card"><h3>C · 高质量教练（Coach）</h3>
      <div class="el ${c.coach?'done':''}"><div class="idx">C</div><p>探寻高质量教练，与教练研判 C139 各项内容，获得<b>达成共识的 C139 值（*C）</b><br><small>教练标准：①希望我方赢单 ②在决策结构中有影响力 ③愿意主动提供信息并核实</small></p>
        <div class="seg"><button class="${c.coach?'on-y':''}" onclick="setC('coach',true)">已确认</button><button class="${!c.coach?'on-n':''}" onclick="setC('coach',false)">未确认</button></div></div>
      <label class="f"><span>教练信息与备注（注意保密）</span><input value="${esc(c.note||'')}" onchange="getProj().c139.note=this.value;persist()" placeholder="教练是谁、其角色与最近提供的关键信息"></label></div>
    <div class="card"><h3>1 · 决定者是否选定我方（1Win）</h3>
      <div class="el ${c.is1W?'done':''}"><div class="idx">1</div><p>决定者选定我们，或主动协助我们策划、实施项目获取过程</p>
        <div class="seg"><button class="${c.is1W?'on-y':''}" onclick="setC('is1W',true)">是</button><button class="${!c.is1W?'on-n':''}" onclick="setC('is1W',false)">否</button></div></div></div>
    <div class="card"><h3>3 · 三项价值共识（F）</h3>
      ${C139_CONSENSUS.map((t,i)=>`<div class="el ${c.consensus[i]?'done':''}"><div class="idx">${i+1}</div><p>${t}</p>
        <div class="seg"><button class="${c.consensus[i]?'on-y':''}" onclick="setCons(${i},true)">达成</button><button class="${!c.consensus[i]?'on-n':''}" onclick="setCons(${i},false)">未达成</button></div></div>`).join('')}</div>
    <div class="card"><h3>9 · 关键要素确认（C，建议与教练共同研判）</h3>
      ${C139_FACTORS.map((f,i)=>`<div class="el ${c.factors[i]?'done':''}"><div class="idx">${i+1}</div><p><b>${f[0]}</b><br><small>${f[1]}</small></p>
        <div class="seg"><button class="${c.factors[i]?'on-y':''}" onclick="setFac(${i},true)">已掌握</button><button class="${!c.factors[i]?'on-n':''}" onclick="setFac(${i},false)">未掌握</button></div></div>`).join('')}</div>`;
}
function c139Normalize(c){if(!c||!Array.isArray(c.consensus)||!Array.isArray(c.factors))return defaultC139();return c}
function setC(k,v){const p=getProj(document.getElementById('c139Proj').value);p.c139[k]=v;persist();renderC139()}
function setCons(i,v){const p=getProj(document.getElementById('c139Proj').value);p.c139.consensus[i]=v;persist();renderC139()}
function setFac(i,v){const p=getProj(document.getElementById('c139Proj').value);p.c139.factors[i]=v;persist();renderC139()}

/* ================= 工具箱 ================= */
const CHECK_ITEMS=[
 ['招标信息','获取招标文件并通读，标记★号条款、否决条款、评分办法'],
 ['招标信息','确认投标截止时间、开标时间、递交方式（电子/纸质份数）'],
 ['资格','营业执照/资质证书/业绩要求等资格条件逐项核对'],
 ['资格','缴纳社保、纳税证明、财务报告等时效性检查'],
 ['决策','是否投标决策会：竞争态势、C139评估、报价空间'],
 ['方案','技术响应偏离表：逐条响应，无漏项，★条款正偏离'],
 ['方案','整体方案与评分办法逐项对应，加分点材料齐备'],
 ['方案','人员证书/社保挂靠关系满足要求'],
 ['商务','报价测算复核（成本底线、竞争对手报价预判）'],
 ['商务','投标保函/保证金按时缴纳'],
 ['合规','授权委托书、法人签字盖章齐全'],
 ['合规','文件格式：封面、目录、页码、装订、密封要求'],
 ['合规','交叉审核：非编制人通读全文，检查错漏与废标点'],
 ['递交','提前到场/上传，预留突发情况时间'],
 ['述标','述标PPT演练、Q&A分工、答辩口径统一'],
 ['复盘','开标后无论结果，一周内完成复盘并更新知识库']];
function renderTools(){
  const sel=document.getElementById('chkProj');
  sel.innerHTML=store.projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')||'<option value="">暂无项目</option>';
  if(!sel.value&&currentProjectId)sel.value=currentProjectId;
  renderChecklist();
  document.getElementById('methodRef').innerHTML=`
    <div class="kb-item"><b>C139 模型</b><div class="body">C=高质量教练确认（*C值）；1=决定者选定我方；3=三项价值共识；9=九大关键要素。核心逻辑：先建立教练，用教练校准信息，向 1Win 推进。5C 为制胜拐点、6C（无1Win）为死亡拐点。</div></div>
    <div class="kb-item"><b>售前四步节奏</b><div class="body">①摸清背景（背景收集表+C139初评）→ ②首次交流建立信任（首次PPT）→ ③方案价值耦合（技术PPT+高层汇报）→ ④招投标控标与高质量交付文件（Word+述标PPT）。</div></div>
    <div class="kb-item"><b>输标/流标复盘模板</b><div class="body">结果与分差 → C139 回看哪一环失真 → 信息/关系/方案/报价四维归因 → 知识库沉淀（竞品情报/客户档案更新）→ 改进项落到下个项目任务。</div></div>`;
}
function renderChecklist(){
  const pid=document.getElementById('chkProj').value;
  const key='chk_'+pid;
  const st=store.checklists[key]=store.checklists[key]||Array(CHECK_ITEMS.length).fill(false);
  document.getElementById('checklist').innerHTML=CHECK_ITEMS.map((it,i)=>
    `<div class="checkrow"><label><input type="checkbox" ${st[i]?'checked':''} onchange="store.checklists['${key}'][${i}]=this.checked;persist()"><span><span class="tag" style="margin-right:6px">${it[0]}</span>${it[1]}</span></label></div>`).join('');
}
function resetChecklist(){const pid=document.getElementById('chkProj').value;store.checklists['chk_'+pid]=Array(CHECK_ITEMS.length).fill(false);persist();renderChecklist();toast('已重置')}

/* ================= 仪表盘 ================= */
function renderDash(){
  const ps=store.projects;
  const active=ps.filter(p=>!LOST_STAGES.includes(p.stage)&&p.stage!=='已中标');
  const won=ps.filter(p=>p.stage==='已中标');
  const lost=ps.filter(p=>LOST_STAGES.includes(p.stage));
  const estSum=active.reduce((s,p)=>s+amountsOf(p).est,0);
  const wgtSum=active.reduce((s,p)=>s+amountsOf(p).est*c139Stats(p.c139).rate/100,0);
  const wonSum=won.reduce((s,p)=>s+amountsOf(p).won,0);
  const profitSum=won.reduce((s,p)=>s+marginOf(p).profit,0);
  const winRate=(won.length+lost.length)?Math.round(won.length/(won.length+lost.length)*100):0;
  const avgRate=active.length?Math.round(active.reduce((s,p)=>s+c139Stats(p.c139).rate,0)/active.length):0;
  const steps=allOpenSteps(), risks=allOpenRisks();
  const overSteps=steps.filter(s=>dueState(s.due)==='over').length;
  const highRisk=risks.filter(r=>r.level==='高').length;
  document.getElementById('dashKpis').innerHTML=[
    ['在跟项目',active.length,'个'],['预估总额',fmtWan(Math.round(estSum*10)/10),'万'],
    ['加权金额',fmtWan(Math.round(wgtSum*10)/10),'万'],['已中标合同额',fmtWan(Math.round(wonSum*10)/10),'万'],
    ['已中标毛利',fmtWan(Math.round(profitSum*10)/10),'万'],['中标率',winRate,'%'],['平均赢单率',avgRate,'%'],
    ['逾期下一步',overSteps,'项'],['高风险未关闭',highRisk,'项']
  ].map(k=>`<div class="kpi"><div class="lb">${k[0]}</div><div class="num">${k[1]}<small style="font-size:12px;font-weight:400"> ${k[2]}</small></div><div class="lb">&nbsp;</div></div>`).join('');
  const stages=['前期交流','方案阶段','招投标阶段','已中标','已流标','已输标','项目已取消'];
  const max=Math.max(1,...stages.map(s=>ps.filter(p=>p.stage===s).length));
  const funnelHtml=stages.map(s=>{
    const n=ps.filter(p=>p.stage===s).length;
    return `<div class="funnel-row"><div class="fname">${s}</div><div class="fbar"><i style="width:${Math.round(n/max*100)}%">${n}</i></div></div>`}).join('');
  const lvHtml=OPP_LEVELS.map(l=>`<span class="tag" style="margin:2px 8px 2px 0">${l} · ${active.filter(p=>p.oppLevel===l).length}</span>`).join('');
  document.getElementById('dashFunnel').innerHTML=funnelHtml+
    `<div style="margin-top:12px;border-top:1px dashed var(--line);padding-top:10px;font-size:12px;color:var(--sub)">在跟项目商机级别：${lvHtml||'—'}</div>`;
  document.getElementById('dashNext').innerHTML=steps.length?'<table>'+steps.slice(0,8).map(s=>{const st=dueState(s.due);
    return `<tr><td><b style="cursor:pointer;color:var(--brand)" onclick="openDetail('${s.pid}')">${esc(s.what)}</b><br><small style="color:var(--sub)">${esc(s.pname)}${s.owner?' · '+esc(s.owner):''}</small></td>
    <td style="text-align:right;white-space:nowrap"><span class="pct" style="color:${dueColor(st)};font-weight:700">${esc(s.due)}</span> <span class="tag" style="color:${dueColor(st)}">${st==='over'?'逾期':'临期'}</span></td></tr>`}).join('')+'</table>'
    +'<div class="hint" style="margin-top:8px">共 '+steps.length+' 项逾期或本周到期</div>'
    :'<div class="empty">没有逾期或本周到期的下一步</div>';
  document.getElementById('dashRisk').innerHTML=risks.length?'<table>'+risks.slice(0,8).map(r=>
    `<tr><td style="width:44px;text-align:center"><b style="color:${levelColor(r.level)};font-size:15px">${esc(r.level)}</b><br><small style="color:var(--sub)">${esc(r.kind)}</small></td>
     <td><b style="cursor:pointer;color:var(--brand)" onclick="openDetail('${r.pid}')">${esc(r.desc)}</b><br><small style="color:var(--sub)">${esc(r.pname)} · ${esc(r.status)}${r.owner?' · '+esc(r.owner):''}</small></td></tr>`).join('')+'</table>'
    +'<div class="hint" style="margin-top:8px">共 '+risks.length+' 项未关闭（高 '+highRisk+' 项）</div>'
    :'<div class="empty">暂无未关闭的风险与问题</div>';
  const top=[...active].sort((a,b)=>c139Stats(b.c139).rate-c139Stats(a.c139).rate).slice(0,6);
  document.getElementById('dashTop').innerHTML=top.length?'<table>'+top.map(p=>{const s=c139Stats(p.c139);return `<tr><td><b style="cursor:pointer;color:var(--brand)" onclick="openDetail('${p.id}')">${esc(p.name)}</b><br><small style="color:var(--sub)">${esc(p.customer)}</small></td>
    <td style="text-align:right"><span class="pct" style="font-weight:700;color:${s.rate>=85?'var(--ok)':s.rate>=50?'#b25e0c':'var(--bad)'}">${s.rate}%</span> ${zoneBadge(s.zone)}</td></tr>`}).join('')+'</table>'
    :'<div class="empty">暂无在途项目</div>';
  const events=[];ps.forEach(p=>(p.timeline||[]).slice(0,3).forEach(t=>events.push({...t,pname:p.name,id:p.id})));
  events.sort((a,b)=>b.d.localeCompare(a.d));
  document.getElementById('dashRecent').innerHTML=events.slice(0,8).map(e=>`<div class="tl-item"><div class="d">${esc(e.d)}</div><div class="t"><b style="cursor:pointer;color:var(--brand)" onclick="openDetail('${e.id}')">${esc(e.pname)}</b> · ${esc(e.t)}</div></div>`).join('')||'<div class="empty">暂无动态</div>';
}

/* ================= 二期：跟进记录 / 下一步计划 / 风险与问题 ================= */
const FOLLOW_WAYS=['电话','微信','拜访','会议','邮件','其他'];
const RISK_KINDS=['风险','问题'];
const RISK_LEVELS=['高','中','低'];
const RISK_STATUS=['开放','跟踪中','已缓解','已关闭'];
const SOON_DAYS=7;   // 「本周到期」窗口
function addDays(s,n){const d=new Date(s+'T00:00:00');d.setDate(d.getDate()+n);return fmtDate(d)}
function dueState(d){if(!d)return '';if(d<today())return 'over';if(d<=addDays(today(),SOON_DAYS))return 'soon';return ''}
function dueColor(st){return st==='over'?'var(--bad)':st==='soon'?'#b25e0c':'var(--sub)'}
function fuList(pid){return store.followups[pid]=store.followups[pid]||[]}
function levelColor(l){return l==='高'?'var(--bad)':l==='中'?'#b25e0c':'var(--sub)'}

function renderDtFollow(p){
  const list=[...fuList(p.id)].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  return `<div class="card"><h3>跟进与沟通记录</h3>
    <div class="grid g4">
      <label class="f"><span>跟进时间</span><input id="fuDate" type="date" value="${today()}"></label>
      <label class="f"><span>沟通方式</span><select id="fuWay">${FOLLOW_WAYS.map(w=>`<option>${w}</option>`).join('')}</select></label>
      <label class="f"><span>跟进人</span><input id="fuBy" value="${esc(p.presales||p.sales||'')}"></label>
      <label class="f"><span>下次跟进</span><input id="fuNext" type="date"></label></div>
    <div style="display:flex;gap:8px"><input id="fuContent" placeholder="沟通核心内容：对方反馈、承诺、分歧、达成的下一步…" onkeydown="if(event.key==='Enter')fuAdd()">
    <button class="btn" onclick="fuAdd()">记录</button></div>
    ${list.length?`<div style="overflow-x:auto"><table style="margin-top:12px"><tr><th style="width:100px">时间</th><th style="width:70px">方式</th><th style="width:80px">跟进人</th><th>核心内容</th><th style="width:100px">下次跟进</th><th style="width:46px"></th></tr>`+
      list.map(f=>{const st=dueState(f.next);return `<tr><td>${esc(f.date)}</td><td><span class="tag">${esc(f.way)}</span></td><td>${esc(f.by||'—')}</td>
      <td>${esc(f.content)}</td><td>${f.next?`<span style="color:${dueColor(st)}">${esc(f.next)}${st==='over'?' 逾期':''}</span>`:'—'}</td>
      <td><button class="btn sm danger" onclick="fuDel('${f.id}')">✕</button></td></tr>`}).join('')+'</table></div>'
      :'<div class="empty" style="margin-top:12px">暂无跟进记录</div>'}
    <div class="hint" style="margin-top:10px">每条跟进会自动写入项目时间线，首页「最近动态」同步可见；填了「下次跟进」日期会进首页待办提醒。</div></div>`;
}
function fuAdd(){
  const c=document.getElementById('fuContent').value.trim();if(!c){toast('请填写沟通核心内容');return}
  const p=getProj();const way=document.getElementById('fuWay').value;
  const f={id:uid(),date:document.getElementById('fuDate').value||today(),way,by:document.getElementById('fuBy').value.trim(),
    content:c,next:document.getElementById('fuNext').value||''};
  fuList(p.id).push(f);addTl(p,'跟进（'+way+'）：'+c.slice(0,40));persist();renderDetail();toast('已记录跟进')
}
function fuDel(id){const p=getProj();store.followups[p.id]=fuList(p.id).filter(x=>x.id!==id);persist();renderDetail()}

function renderDtPlan(p){
  p.nextSteps=p.nextSteps||[];
  const open=p.nextSteps.filter(s=>!s.done).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
  const done=p.nextSteps.filter(s=>s.done);
  const rows=list=>list.map(s=>{const i=p.nextSteps.indexOf(s),st=s.due?dueState(s.due):'';
    return `<div class="task ${s.done?'done':''}"><input type="checkbox" ${s.done?'checked':''} onchange="stepToggle(${i})">
      <span style="flex:1">${esc(s.what)}${s.owner?`<small style="color:var(--sub)"> · ${esc(s.owner)}</small>`:''}</span>
      <span class="tag" style="color:${dueColor(st)};white-space:nowrap">${esc(s.due||'未定')}${st==='over'?' 逾期':st==='soon'?' 临期':''}</span>
      <button class="btn sm danger" onclick="stepDel(${i})">✕</button></div>`}).join('');
  return `<div class="card"><h3>下一步计划</h3>
    <div class="grid g4">
      <label class="f"><span>事项</span><input id="nsWhat" placeholder="如：约科技处做方案澄清" onkeydown="if(event.key==='Enter')stepAdd()"></label>
      <label class="f"><span>责任人</span><input id="nsOwner" value="${esc(p.presales||p.sales||'')}"></label>
      <label class="f"><span>截止日期</span><input id="nsDue" type="date" value="${addDays(today(),SOON_DAYS)}"></label>
      <label class="f"><span>&nbsp;</span><button class="btn" onclick="stepAdd()">＋ 添加下一步</button></label></div>
    <div style="margin-top:6px">${rows(open)||'<div class="empty">暂无未完成的下一步</div>'}</div>
    ${done.length?`<div class="hint" style="margin-top:10px">已完成 ${done.length} 项</div>${rows(done)}`:''}
    <div class="hint" style="margin-top:12px">与「推进计划与任务」的分工：那里是阶段标准动作清单，这里是带责任人和截止日的具体待办，逾期与本周到期会进首页预警。</div></div>`;
}
function stepAdd(){
  const w=document.getElementById('nsWhat').value.trim();if(!w){toast('请填写事项');return}
  const p=getProj();p.nextSteps=p.nextSteps||[];
  p.nextSteps.push({id:uid(),what:w,owner:document.getElementById('nsOwner').value.trim(),due:document.getElementById('nsDue').value||'',done:false});
  addTl(p,'新增下一步：'+w);persist();renderDetail()
}
function stepToggle(i){const p=getProj();const s=(p.nextSteps||[])[i];if(!s)return;s.done=!s.done;
  addTl(p,(s.done?'完成下一步：':'重新打开下一步：')+s.what);persist();renderDetail()}
function stepDel(i){const p=getProj();p.nextSteps.splice(i,1);persist();renderDetail()}

function renderDtRisk(p){
  p.risks=p.risks||[];
  const open=p.risks.filter(r=>r.status!=='已关闭').sort((a,b)=>RISK_LEVELS.indexOf(a.level)-RISK_LEVELS.indexOf(b.level));
  const closed=p.risks.filter(r=>r.status==='已关闭');
  const rows=list=>list.length?`<div style="overflow-x:auto"><table><tr><th style="width:56px">类型</th><th style="width:48px">等级</th><th>风险 / 问题描述</th><th style="width:80px">责任人</th><th style="width:104px">状态</th><th style="width:46px"></th></tr>`+
    list.map(r=>{const i=p.risks.indexOf(r);return `<tr><td><span class="tag">${esc(r.kind)}</span></td>
      <td><b style="color:${levelColor(r.level)}">${esc(r.level)}</b></td>
      <td>${esc(r.desc)}${r.mitigation?`<br><small style="color:var(--sub)">应对：${esc(r.mitigation)}</small>`:''}<br><small style="color:var(--sub)">发现 ${esc(r.found||'—')}</small></td>
      <td>${esc(r.owner||'—')}</td>
      <td><select onchange="riskSet(${i},'status',this.value)" style="padding:3px 6px">${RISK_STATUS.map(s=>`<option ${s===r.status?'selected':''}>${s}</option>`).join('')}</select></td>
      <td><button class="btn sm danger" onclick="riskDel(${i})">✕</button></td></tr>`}).join('')+'</table></div>':'';
  return `<div class="card"><h3>风险与问题管理</h3>
    <div class="grid g4">
      <label class="f"><span>类型</span><select id="rkKind">${RISK_KINDS.map(k=>`<option>${k}</option>`).join('')}</select></label>
      <label class="f"><span>等级</span><select id="rkLevel">${RISK_LEVELS.map((l,i)=>`<option ${i===1?'selected':''}>${l}</option>`).join('')}</select></label>
      <label class="f"><span>责任人</span><input id="rkOwner" value="${esc(p.presales||p.sales||'')}"></label>
      <label class="f"><span>应对措施（可选）</span><input id="rkMit" placeholder="如：提前锁定答疑澄清窗口"></label></div>
    <div style="display:flex;gap:8px"><input id="rkDesc" placeholder="风险 / 问题描述，如：客户预算尚未批复，招标可能延后" onkeydown="if(event.key==='Enter')riskAdd()">
    <button class="btn" onclick="riskAdd()">＋ 登记</button></div>
    <div style="margin-top:12px">${rows(open)||'<div class="empty">暂无未关闭的风险与问题</div>'}</div>
    ${closed.length?`<div class="hint" style="margin-top:10px">已关闭 ${closed.length} 项</div>${rows(closed)}`:''}
    ${p.lostReason?`<div style="margin-top:12px;color:var(--bad)"><b>${esc(p.stage)}原因（已归档）：</b>${esc(p.lostReason)}</div>`:''}
    <div class="hint" style="margin-top:10px">高等级且未关闭的风险会进首页预警；项目进入流标/输标/取消时，原因在「基本信息」里单独归档留存。</div></div>`;
}
function riskAdd(){
  const d=document.getElementById('rkDesc').value.trim();if(!d){toast('请填写风险或问题描述');return}
  const p=getProj();p.risks=p.risks||[];
  const kind=document.getElementById('rkKind').value, level=document.getElementById('rkLevel').value;
  p.risks.push({id:uid(),kind,level,desc:d,owner:document.getElementById('rkOwner').value.trim(),
    mitigation:document.getElementById('rkMit').value.trim(),status:'开放',found:today()});
  addTl(p,'登记'+kind+'（'+level+'）：'+d.slice(0,40));persist();renderDetail();toast('已登记')
}
function riskSet(i,f,v){const p=getProj();const r=(p.risks||[])[i];if(!r)return;r[f]=v;
  if(f==='status')addTl(p,'风险状态→'+v+'：'+r.desc.slice(0,30));persist();renderDetail()}
function riskDel(i){const p=getProj();p.risks.splice(i,1);persist();renderDetail()}

/* 汇总给首页预警用 */
function allOpenSteps(){const a=[];store.projects.forEach(p=>(p.nextSteps||[]).forEach(s=>{
  if(!s.done&&s.due&&s.due<=addDays(today(),SOON_DAYS))a.push(Object.assign({},s,{pid:p.id,pname:p.name}))}));
  return a.sort((x,y)=>x.due.localeCompare(y.due))}
function allOpenRisks(){const a=[];store.projects.forEach(p=>(p.risks||[]).forEach(r=>{
  if(r.status!=='已关闭')a.push(Object.assign({},r,{pid:p.id,pname:p.name}))}));
  return a.sort((x,y)=>RISK_LEVELS.indexOf(x.level)-RISK_LEVELS.indexOf(y.level))}

/* ================= 数据备份 ================= */
function exportAll(){download('售前工作台数据备份-'+today()+'.json',JSON.stringify(store,null,2),'application/json');toast('已导出备份文件')}
function resetDemo(){
  if(!confirm('重置为演示数据？当前服务器与本机的工作数据将被覆盖。'))return;
  store={projects:[],kb:[],docs:[],tasks:[],kbTree:[],pdocs:{},checklists:{},
    stakeholders:{},contracts:{},quotations:{},compintel:[],requirements:{},followups:{}};
  _sent={};_rev={};
  seed();persist();
  pushImportToServer().then(function(){show('dash');renderDash();renderProjects();toast('已重置为演示数据')});
}
function importAll(inp){const f=inp.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{store=JSON.parse(r.result);persist();show('dash');toast('导入成功');pushImportToServer()}catch(e){toast('文件格式错误')}};r.readAsText(f);inp.value=''}

/* ================= 通用页面项目选择器 ================= */
function projSelectHtml(id,onchange,opts={}){
  const cur=document.getElementById(id)?document.getElementById(id).value:(opts.value||currentProjectId||'');
  return `<select id="${id}" onchange="${onchange}" style="${opts.style||'width:260px'}">
    ${opts.empty?'<option value="">'+opts.empty+'</option>':''}
    ${store.projects.map(p=>`<option value="${p.id}">${esc(p.name)}（${esc(p.customer)}）</option>`).join('')}
  </select>`;
}
function fillProjSelect(id,value=''){
  const el=document.getElementById(id);if(!el)return;
  el.innerHTML='<option value="">— 请选择项目 —</option>'+store.projects.map(p=>`<option value="${p.id}">${esc(p.name)}（${esc(p.customer)}）</option>`).join('');
  if(value&&store.projects.some(p=>p.id===value))el.value=value;
  else if(currentProjectId&&store.projects.some(p=>p.id===currentProjectId))el.value=currentProjectId;
}

/* ================= 干系人管理 ================= */
function renderStakeholders(){
  const el=document.getElementById('stkBody');
  fillProjSelect('stkProj',currentProjectId);
  const pid=document.getElementById('stkProj').value;
  const p=getProj(pid);
  if(!p){el.innerHTML='<div class="card"><div class="empty">暂无项目，请先在「项目管理」中创建</div></div>';return}
  const list=store.stakeholders[pid]||[];
  let h=`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div><h3 style="margin:0">${esc(p.name)} 干系人</h3><div style="font-size:12px;color:var(--sub)">${esc(p.customer)} · 共 ${list.length} 人</div></div>
    <button class="btn" onclick="openStakeholderModal()">＋ 新增干系人</button></div>`;
  if(!list.length){h+='<div class="empty">暂无干系人，点击右上角新增</div></div>';el.innerHTML=h;return}
  h+=`<table><tr><th>姓名</th><th>角色</th><th>部门/职务</th><th>影响力</th><th>态度</th><th>关注重点</th><th style="width:140px">操作</th></tr>`+
  list.map((s,i)=>`<tr>
    <td><b>${esc(s.name||'—')}</b></td>
    <td>${esc(s.role||'—')}</td>
    <td>${esc(s.dept||'—')} / ${esc(s.title||'—')}</td>
    <td>${influenceBadge(s.influence)}</td>
    <td>${attitudeBadge(s.attitude)}</td>
    <td style="max-width:240px">${esc(s.focus||'')}</td>
    <td><button class="btn sm ghost" onclick="openStakeholderModal('${s.id}')">编辑</button> <button class="btn sm danger" onclick="delStakeholder('${s.id}')">删除</button></td>
  </tr>`).join('')+'</table></div>';
  h+=`<div class="card"><h3>干系人地图速览</h3><div class="grid g4">`+
    ['高','中','低'].map(inf=>{
      const cnt=list.filter(s=>s.influence===inf).length;
      return `<div style="background:#f8fafd;border-radius:10px;padding:12px"><div style="font-size:12px;color:var(--sub)">影响力 ${inf}</div><div style="font-size:22px;font-weight:800">${cnt}</div></div>`
    }).join('')+`</div></div>`;
  el.innerHTML=h;
}
function influenceBadge(v){return v==='high'?'<span class="tag" style="background:#fde8ef;color:var(--bad)">高</span>':v==='low'?'<span class="tag" style="background:#e6f4ea;color:var(--ok)">低</span>':'<span class="tag">中</span>'}
function attitudeBadge(v){return v==='support'?'<span class="tag" style="background:#e6f4ea;color:var(--ok)">支持</span>':v==='oppose'?'<span class="tag" style="background:#fde8ef;color:var(--bad)">反对</span>':'<span class="tag">中立</span>'}
function openStakeholderModal(id){
  const pid=document.getElementById('stkProj').value;
  const s=id?(store.stakeholders[pid]||[]).find(x=>x.id===id):null;
  document.getElementById('stkModalTitle').textContent=s?'编辑干系人':'新增干系人';
  document.getElementById('stkId').value=s?s.id:'';
  document.getElementById('stkName').value=s?s.name:'';
  document.getElementById('stkTitle').value=s?s.title:'';
  document.getElementById('stkDept').value=s?s.dept:'';
  document.getElementById('stkRole').value=s?s.role:'';
  document.getElementById('stkInfluence').value=s?s.influence:'medium';
  document.getElementById('stkAttitude').value=s?s.attitude:'neutral';
  document.getElementById('stkPhone').value=s?s.phone:'';
  document.getElementById('stkEmail').value=s?s.email:'';
  document.getElementById('stkFocus').value=s?s.focus:'';
  document.getElementById('stkNotes').value=s?s.notes:'';
  openMask('mStakeholder');
}
function saveStakeholder(){
  const pid=document.getElementById('stkProj').value;if(!pid)return;
  const name=document.getElementById('stkName').value.trim();
  if(!name){toast('请填写姓名');return}
  store.stakeholders[pid]=store.stakeholders[pid]||[];
  const id=document.getElementById('stkId').value;
  const data={
    id:id||uid(),name,title:document.getElementById('stkTitle').value.trim(),
    dept:document.getElementById('stkDept').value.trim(),role:document.getElementById('stkRole').value,
    influence:document.getElementById('stkInfluence').value,attitude:document.getElementById('stkAttitude').value,
    phone:document.getElementById('stkPhone').value.trim(),email:document.getElementById('stkEmail').value.trim(),
    focus:document.getElementById('stkFocus').value.trim(),notes:document.getElementById('stkNotes').value.trim(),
    updated:today()
  };
  if(id){const i=store.stakeholders[pid].findIndex(x=>x.id===id);if(i>-1)store.stakeholders[pid][i]=data}
  else store.stakeholders[pid].push(data);
  persist();closeMask('mStakeholder');renderStakeholders();toast('已保存');
}
function delStakeholder(id){if(!confirm('确定删除该干系人？'))return;const pid=document.getElementById('stkProj').value;store.stakeholders[pid]=(store.stakeholders[pid]||[]).filter(x=>x.id!==id);persist();renderStakeholders();toast('已删除')}

/* ================= 合同管理 ================= */
function renderContracts(){
  const el=document.getElementById('ctBody');
  fillProjSelect('ctProj',currentProjectId);
  const pid=document.getElementById('ctProj').value;
  const p=getProj(pid);
  if(!p){el.innerHTML='<div class="card"><div class="empty">暂无项目，请先在「项目管理」中创建</div></div>';return}
  const c=store.contracts[pid]||{attachments:[]};
  let h=`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div><h3 style="margin:0">${esc(p.name)} 合同信息</h3><div style="font-size:12px;color:var(--sub)">${esc(p.customer)}</div></div>
    <button class="btn" onclick="openContractModal()">编辑合同信息</button></div>
    <div class="grid g4" style="font-size:13px">`;
  h+=`<div><span style="color:var(--sub)">合同编号</span><br><b>${esc(c.contractNo||'—')}</b></div>`;
  h+=`<div><span style="color:var(--sub)">合同金额</span><br><b>${c.amount!==undefined&&c.amount!==''?esc(c.amount)+' 万':'—'}</b></div>`;
  h+=`<div><span style="color:var(--sub)">签订日期</span><br><b>${esc(c.signDate||'—')}</b></div>`;
  h+=`<div><span style="color:var(--sub)">交付/到期日期</span><br><b>${esc(c.endDate||'—')}</b></div>`;
  h+=`<div><span style="color:var(--sub)">付款条款</span><br><b>${esc(c.paymentTerms||'—')}</b></div>`;
  h+=`<div><span style="color:var(--sub)">状态</span><br><b>${esc(c.status||'—')}</b></div>`;
  h+=`</div><div style="margin-top:10px"><span style="color:var(--sub)">备注</span><br>${esc(c.notes||'—')}</div></div>`;
  h+=`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0">合同附件</h3>
    <label class="btn sm" style="cursor:pointer">⬆ 上传附件<input type="file" style="display:none" onchange="uploadContractFile(this)"></label></div>`;
  const atts=c.attachments||[];
  if(!atts.length){h+='<div class="empty">暂无附件</div></div>';el.innerHTML=h;return}
  h+=`<table><tr><th>文件名</th><th>大小</th><th>上传日期</th><th style="width:140px">操作</th></tr>`+
  atts.map(a=>`<tr><td><b>${esc(a.name)}</b></td><td>${fmtSize(a.size)}</td><td>${esc(a.date||'—')}</td>
    <td><a class="btn sm ghost" href="/api/files/download/${encodeURIComponent(a.fileId)}" target="_blank">下载</a>
    <button class="btn sm danger" onclick="delContractFile('${a.fileId}')">删除</button></td></tr>`).join('')+'</table></div>';
  el.innerHTML=h;
}
function openContractModal(){
  const pid=document.getElementById('ctProj').value;
  const c=store.contracts[pid]||{attachments:[]};
  document.getElementById('ctId').value=pid;
  document.getElementById('ctNo').value=c.contractNo||'';
  document.getElementById('ctAmount').value=c.amount||'';
  document.getElementById('ctSignDate').value=c.signDate||'';
  document.getElementById('ctEndDate').value=c.endDate||'';
  document.getElementById('ctPayment').value=c.paymentTerms||'';
  document.getElementById('ctStatus').value=c.status||'洽谈中';
  document.getElementById('ctNotes').value=c.notes||'';
  openMask('mContract');
}
function saveContract(){
  const pid=document.getElementById('ctProj').value;if(!pid)return;
  store.contracts[pid]={
    contractNo:document.getElementById('ctNo').value.trim(),
    amount:document.getElementById('ctAmount').value,
    signDate:document.getElementById('ctSignDate').value,
    endDate:document.getElementById('ctEndDate').value,
    paymentTerms:document.getElementById('ctPayment').value.trim(),
    status:document.getElementById('ctStatus').value,
    notes:document.getElementById('ctNotes').value.trim(),
    attachments:(store.contracts[pid]||{}).attachments||[]
  };
  persist();closeMask('mContract');renderContracts();toast('已保存');
}
async function uploadContractFile(inp){
  const pid=document.getElementById('ctProj').value;if(!pid||!inp.files[0])return;
  const file=inp.files[0];
  try{
    const r=await fetch('/api/files/upload',{method:'POST',headers:{'x-filename':encodeURIComponent(file.name)},body:file});
    const d=await r.json();if(!d.ok)throw new Error(d.error);
    store.contracts[pid]=store.contracts[pid]||{attachments:[]};
    store.contracts[pid].attachments.push({fileId:d.fileId,name:d.name,size:d.size,date:today()});
    persist();renderContracts();toast('上传成功');
  }catch(e){toast('上传失败：'+e.message)}
  inp.value='';
}
async function delContractFile(fileId){
  if(!confirm('确定删除该附件？'))return;
  const pid=document.getElementById('ctProj').value;
  try{await fetch('/api/files/'+encodeURIComponent(fileId),{method:'DELETE'})}catch(_){}
  store.contracts[pid].attachments=(store.contracts[pid].attachments||[]).filter(a=>a.fileId!==fileId);
  persist();renderContracts();toast('已删除');
}

/* ================= 报价管理 ================= */
function renderQuotations(){
  const el=document.getElementById('qtBody');
  fillProjSelect('qtProj',currentProjectId);
  const pid=document.getElementById('qtProj').value;
  const p=getProj(pid);
  if(!p){el.innerHTML='<div class="card"><div class="empty">暂无项目，请先在「项目管理」中创建</div></div>';return}
  const list=store.quotations[pid]||[];
  let h=`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div><h3 style="margin:0">${esc(p.name)} 报价记录</h3><div style="font-size:12px;color:var(--sub)">${esc(p.customer)} · 共 ${list.length} 版</div></div>
    <button class="btn" onclick="openQuotationModal()">＋ 新增报价</button></div>`;
  if(!list.length){h+='<div class="empty">暂无报价，点击右上角新增</div></div>';el.innerHTML=h;return}
  h+=`<table><tr><th>版本</th><th>日期</th><th>成本合计(万)</th><th>对外报价(万)</th><th>利润(万)</th><th>利润率</th><th>状态</th><th style="width:180px">操作</th></tr>`+
  list.map(q=>{
    const cost=sumQtCost(q),quote=sumQtQuote(q),profit=quote-cost,margin=quote?Math.round(profit/quote*100):0;
    return `<tr>
      <td><b>${esc(q.name)}</b></td><td>${esc(q.date||'—')}</td><td>${cost.toFixed(2)}</td><td>${quote.toFixed(2)}</td>
      <td>${profit.toFixed(2)}</td><td style="color:${margin>=30?'var(--ok)':margin>=15?'#b25e0c':'var(--bad)'}">${margin}%</td>
      <td>${esc(q.status||'草稿')}</td>
      <td><button class="btn sm ghost" onclick="openQuotationModal('${q.id}')">编辑</button>
        ${q.excelFile?`<a class="btn sm ghost" href="/api/files/download/${encodeURIComponent(q.excelFile.fileId)}" target="_blank">下载Excel</a>`:`<label class="btn sm ghost" style="cursor:pointer">上传Excel<input type="file" accept=".xlsx,.xls" style="display:none" onchange="uploadQuotationExcel(this,'${q.id}')"></label>`}
        <button class="btn sm danger" onclick="delQuotation('${q.id}')">删除</button></td></tr>`
  }).join('')+'</table></div>';
  if(list.length){
    const latest=list[0];
    const cost=sumQtCost(latest),quote=sumQtQuote(latest),profit=quote-cost,margin=quote?Math.round(profit/quote*100):0;
    h+=`<div class="card"><h3>最新报价利润分析（${esc(latest.name)}）</h3>
      <div class="grid g4" style="font-size:13px">
        <div><span style="color:var(--sub)">成本合计</span><br><b style="font-size:20px">${cost.toFixed(2)}</b> 万</div>
        <div><span style="color:var(--sub)">对外报价</span><br><b style="font-size:20px">${quote.toFixed(2)}</b> 万</div>
        <div><span style="color:var(--sub)">预计利润</span><br><b style="font-size:20px;color:${profit>=0?'var(--ok)':'var(--bad)'}">${profit.toFixed(2)}</b> 万</div>
        <div><span style="color:var(--sub)">利润率</span><br><b style="font-size:20px;color:${margin>=30?'var(--ok)':margin>=15?'#b25e0c':'var(--bad)'}">${margin}%</b></div>
      </div>
      <div class="hint" style="margin-top:12px">${margin>=30?'利润率健康，有议价空间。':margin>=15?'利润率中等，注意成本控制与报价策略。':'利润率偏低，需复核成本或调整方案。'}</div>
    </div>`;
  }
  el.innerHTML=h;
}
function sumQtCost(q){return (q.items||[]).reduce((s,it)=>s+(parseFloat(it.cost)||0)*(parseFloat(it.qty)||1),0)}
function sumQtQuote(q){return (q.items||[]).reduce((s,it)=>s+(parseFloat(it.quote)||0)*(parseFloat(it.qty)||1),0)}
let _qtItems=[];
function openQuotationModal(id){
  const pid=document.getElementById('qtProj').value;
  const q=id?(store.quotations[pid]||[]).find(x=>x.id===id):null;
  document.getElementById('qtModalTitle').textContent=q?'编辑报价':'新增报价';
  document.getElementById('qtId').value=q?q.id:'';
  document.getElementById('qtName').value=q?q.name:'';
  document.getElementById('qtDate').value=q?q.date:today();
  document.getElementById('qtStatus').value=q?q.status:'草稿';
  document.getElementById('qtNotes').value=q?q.notes:'';
  _qtItems=q&&q.items?q.items.map(x=>({...x})):[];
  renderQtItems();
  openMask('mQuotation');
}
function renderQtItems(){
  document.getElementById('qtItems').innerHTML=_qtItems.length?`<table><tr><th>名称</th><th>数量</th><th>成本单价(万)</th><th>报价单价(万)</th><th>小计成本</th><th>小计报价</th><th>备注</th><th></th></tr>`+
  _qtItems.map((it,i)=>`<tr>
    <td><input value="${esc(it.name||'')}" onchange="_qtItems[${i}].name=this.value" placeholder="成本项"></td>
    <td><input type="number" value="${esc(it.qty||1)}" onchange="_qtItems[${i}].qty=this.value" style="width:70px"></td>
    <td><input type="number" step="0.01" value="${esc(it.cost||0)}" onchange="_qtItems[${i}].cost=this.value" style="width:110px"></td>
    <td><input type="number" step="0.01" value="${esc(it.quote||0)}" onchange="_qtItems[${i}].quote=this.value" style="width:110px"></td>
    <td>${((parseFloat(it.cost)||0)*(parseFloat(it.qty)||1)).toFixed(2)}</td>
    <td>${((parseFloat(it.quote)||0)*(parseFloat(it.qty)||1)).toFixed(2)}</td>
    <td><input value="${esc(it.remark||'')}" onchange="_qtItems[${i}].remark=this.value" placeholder="备注"></td>
    <td><button class="btn sm danger" onclick="_qtItems.splice(${i},1);renderQtItems()">✕</button></td>
  </tr>`).join('')+'</table>':'<div class="empty">暂无明细，点击下方添加</div>';
}
function addQtItem(){_qtItems.push({name:'',qty:1,cost:0,quote:0,remark:''});renderQtItems()}
async function saveQuotation(){
  const pid=document.getElementById('qtProj').value;if(!pid)return;
  const name=document.getElementById('qtName').value.trim();if(!name){toast('请填写版本/名称');return}
  store.quotations[pid]=store.quotations[pid]||[];
  const id=document.getElementById('qtId').value;
  const data={id:id||uid(),name,date:document.getElementById('qtDate').value,status:document.getElementById('qtStatus').value,
    notes:document.getElementById('qtNotes').value.trim(),items:_qtItems.map(x=>({...x}))};
  if(id){const i=store.quotations[pid].findIndex(x=>x.id===id);if(i>-1){data.excelFile=store.quotations[pid][i].excelFile;store.quotations[pid][i]=data}}
  else store.quotations[pid].unshift(data);
  persist();closeMask('mQuotation');renderQuotations();toast('已保存');
}
async function uploadQuotationExcel(inp,qid){
  const pid=document.getElementById('qtProj').value;if(!pid||!inp.files[0]||!qid)return;
  const file=inp.files[0];
  try{
    const r=await fetch('/api/files/upload',{method:'POST',headers:{'x-filename':encodeURIComponent(file.name)},body:file});
    const d=await r.json();if(!d.ok)throw new Error(d.error);
    const list=store.quotations[pid]||[];const q=list.find(x=>x.id===qid);
    if(q){q.excelFile={fileId:d.fileId,name:d.name,size:d.size,date:today()};persist();renderQuotations();toast('Excel 已上传')}
  }catch(e){toast('上传失败：'+e.message)}
  inp.value='';
}
function delQuotation(id){if(!confirm('确定删除该报价？'))return;const pid=document.getElementById('qtProj').value;store.quotations[pid]=(store.quotations[pid]||[]).filter(x=>x.id!==id);persist();renderQuotations();toast('已删除')}

/* ================= 竞争情报 ================= */
function renderCompintel(){
  const el=document.getElementById('ciBody');
  const sel=document.getElementById('ciProjFilter');
  sel.innerHTML='<option value="">全部项目</option>'+store.projects.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const kw=(document.getElementById('ciSearch').value||'').toLowerCase();
  const pf=document.getElementById('ciProjFilter').value;
  let list=store.compintel.slice();
  if(pf)list=list.filter(x=>x.projectId===pf);
  if(kw)list=list.filter(x=>(x.competitor+' '+x.product+' '+x.strategy+' '+x.source).toLowerCase().includes(kw));
  if(!list.length){el.innerHTML='<div class="empty">暂无竞争情报，点击右上角新增</div>';return}
  el.innerHTML=list.map(ci=>{
    const p=ci.projectId?getProj(ci.projectId):null;
    return `<div class="kb-item"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <b>${esc(ci.competitor)}</b>${ci.product?`<span class="tag">${esc(ci.product)}</span>`:''}${p?`<span class="tag">${esc(p.name)}</span>`:''}
      <div style="flex:1"></div>
      <span style="font-size:12px;color:var(--sub)">${esc(ci.date||'—')}</span>
      <button class="btn sm ghost" onclick="openCiModal('${ci.id}')">编辑</button>
      <button class="btn sm danger" onclick="delCompintel('${ci.id}')">删除</button></div>
      <div class="grid g2" style="margin-top:10px;font-size:12.5px">
        ${ci.price!==undefined&&ci.price!==''?`<div><span style="color:var(--sub)">报价</span><br><b>${esc(ci.price)} 万</b></div>`:''}
        ${ci.source?`<div><span style="color:var(--sub)">来源</span><br>${esc(ci.source)}</div>`:''}
      </div>
      ${ci.strategy?`<div class="body"><b>市场策略</b><br>${esc(ci.strategy)}</div>`:''}
      ${ci.strengths||ci.weaknesses?`<div style="display:flex;gap:12px;margin-top:8px;font-size:12.5px">
        ${ci.strengths?`<div style="flex:1;background:#e6f4ea;border-radius:8px;padding:10px"><b style="color:var(--ok)">优势</b><br>${esc(ci.strengths)}</div>`:''}
        ${ci.weaknesses?`<div style="flex:1;background:#fde8ef;border-radius:8px;padding:10px"><b style="color:var(--bad)">劣势</b><br>${esc(ci.weaknesses)}</div>`:''}
      </div>`:''}
    </div>`}).join('');
}
function openCiModal(id){
  const ci=id?store.compintel.find(x=>x.id===id):null;
  document.getElementById('ciModalTitle').textContent=ci?'编辑竞争情报':'新增竞争情报';
  document.getElementById('ciId').value=ci?ci.id:'';
  fillProjSelect('ciProj',ci?ci.projectId:'');
  document.getElementById('ciCompetitor').value=ci?ci.competitor:'';
  document.getElementById('ciProduct').value=ci?ci.product:'';
  document.getElementById('ciPrice').value=ci?ci.price:'';
  document.getElementById('ciSource').value=ci?ci.source:'';
  document.getElementById('ciDate').value=ci?ci.date:today();
  document.getElementById('ciStrategy').value=ci?ci.strategy:'';
  document.getElementById('ciStrengths').value=ci?ci.strengths:'';
  document.getElementById('ciWeaknesses').value=ci?ci.weaknesses:'';
  openMask('mCompintel');
}
function saveCompintel(){
  const competitor=document.getElementById('ciCompetitor').value.trim();if(!competitor){toast('请填写竞争对手');return}
  const id=document.getElementById('ciId').value;
  const data={
    id:id||uid(),competitor,projectId:document.getElementById('ciProj').value||null,
    product:document.getElementById('ciProduct').value.trim(),price:document.getElementById('ciPrice').value,
    source:document.getElementById('ciSource').value.trim(),date:document.getElementById('ciDate').value,
    strategy:document.getElementById('ciStrategy').value.trim(),
    strengths:document.getElementById('ciStrengths').value.trim(),
    weaknesses:document.getElementById('ciWeaknesses').value.trim()
  };
  if(id){const i=store.compintel.findIndex(x=>x.id===id);if(i>-1)store.compintel[i]=data}
  else store.compintel.unshift(data);
  persist();closeMask('mCompintel');renderCompintel();toast('已保存');
}
function delCompintel(id){if(!confirm('确定删除该情报？'))return;store.compintel=store.compintel.filter(x=>x.id!==id);persist();renderCompintel();toast('已删除')}

/* ================= 需求管理 ================= */
function renderRequirements(){
  const el=document.getElementById('rqBody');
  fillProjSelect('rqProj',currentProjectId);
  const pid=document.getElementById('rqProj').value;
  const p=getProj(pid);
  if(!p){el.innerHTML='<div class="card"><div class="empty">暂无项目，请先在「项目管理」中创建</div></div>';return}
  const list=store.requirements[pid]||[];
  let h=`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div><h3 style="margin:0">${esc(p.name)} 需求收集与分析</h3><div style="font-size:12px;color:var(--sub)">${esc(p.customer)} · 共 ${list.length} 条</div></div>
    <div style="display:flex;gap:8px">
      <button class="btn ghost" onclick="jumpToPdocsInput('${pid}')">汇入项目知识库 →</button>
      <button class="btn" onclick="openRequirementModal()">＋ 新增需求</button></div></div>`;
  if(!list.length){h+='<div class="empty">暂无需求，点击右上角新增，或去项目知识库录入原始输入</div></div>';el.innerHTML=h;return}
  h+=`<table><tr><th>标题</th><th>类别</th><th>优先级</th><th>来源</th><th>状态</th><th>分析结论</th><th style="width:120px">操作</th></tr>`+
  list.map(r=>`<tr>
    <td><b>${esc(r.title)}</b></td><td>${esc(r.category||'—')}</td><td>${priorityBadge(r.priority)}</td>
    <td>${esc(r.source||'—')}</td><td>${reqStatusBadge(r.status)}</td>
    <td style="max-width:260px">${esc(r.analysis||'—')}</td>
    <td><button class="btn sm ghost" onclick="openRequirementModal('${r.id}')">编辑</button>
    <button class="btn sm danger" onclick="delRequirement('${r.id}')">删除</button></td></tr>`).join('')+'</table></div>';
  const counts={high:0,medium:0,low:0,pending:0,analyzed:0,approved:0};
  list.forEach(r=>{counts[r.priority]=(counts[r.priority]||0)+1;counts[r.status]=(counts[r.status]||0)+1});
  h+=`<div class="card"><h3>需求统计</h3><div class="grid g4" style="font-size:13px">
    <div><span style="color:var(--sub)">高优先级</span><br><b>${counts.high}</b></div>
    <div><span style="color:var(--sub)">中优先级</span><br><b>${counts.medium}</b></div>
    <div><span style="color:var(--sub)">低优先级</span><br><b>${counts.low}</b></div>
    <div><span style="color:var(--sub)">待分析</span><br><b>${counts.pending}</b></div>
  </div></div>`;
  el.innerHTML=h;
}
function priorityBadge(v){return v==='high'?'<span class="tag" style="background:#fde8ef;color:var(--bad)">高</span>':v==='low'?'<span class="tag" style="background:#e6f4ea;color:var(--ok)">低</span>':'<span class="tag">中</span>'}
function reqStatusBadge(v){const map={pending:'待分析',analyzed:'已分析',approved:'已确认',rejected:'已放弃'};return `<span class="tag">${map[v]||v}</span>`}
function openRequirementModal(id){
  const pid=document.getElementById('rqProj').value;
  const r=id?(store.requirements[pid]||[]).find(x=>x.id===id):null;
  document.getElementById('rqModalTitle').textContent=r?'编辑需求':'新增需求';
  document.getElementById('rqId').value=r?r.id:'';
  document.getElementById('rqTitle').value=r?r.title:'';
  document.getElementById('rqCategory').value=r?r.category:'业务需求';
  document.getElementById('rqPriority').value=r?r.priority:'medium';
  document.getElementById('rqStatus').value=r?r.status:'pending';
  document.getElementById('rqSource').value=r?r.source:'';
  document.getElementById('rqKb').value=r?r.relatedKb:'';
  document.getElementById('rqDesc').value=r?r.description:'';
  document.getElementById('rqAnalysis').value=r?r.analysis:'';
  openMask('mRequirement');
}
function saveRequirement(){
  const pid=document.getElementById('rqProj').value;if(!pid)return;
  const title=document.getElementById('rqTitle').value.trim();if(!title){toast('请填写需求标题');return}
  store.requirements[pid]=store.requirements[pid]||[];
  const id=document.getElementById('rqId').value;
  const data={
    id:id||uid(),title,category:document.getElementById('rqCategory').value,
    priority:document.getElementById('rqPriority').value,status:document.getElementById('rqStatus').value,
    source:document.getElementById('rqSource').value.trim(),relatedKb:document.getElementById('rqKb').value.trim(),
    description:document.getElementById('rqDesc').value.trim(),analysis:document.getElementById('rqAnalysis').value.trim(),
    updated:today()
  };
  if(id){const i=store.requirements[pid].findIndex(x=>x.id===id);if(i>-1)store.requirements[pid][i]=data}
  else store.requirements[pid].push(data);
  persist();closeMask('mRequirement');renderRequirements();toast('已保存');
}
function delRequirement(id){if(!confirm('确定删除该需求？'))return;const pid=document.getElementById('rqProj').value;store.requirements[pid]=(store.requirements[pid]||[]).filter(x=>x.id!==id);persist();renderRequirements();toast('已删除')}
function jumpToPdocsInput(pid){
  pdPid=pid;pdTab='input';pdFolder='root';show('pdocs');toast('已切换到项目知识库 · 输入分类');
}

/* ================= 项目详情新标签：干系人 / 合同 ================= */
function renderDtStk(p){
  const list=store.stakeholders[p.id]||[];
  return `<div class="card"><h3>项目干系人</h3>
    ${list.length?`<table><tr><th>姓名</th><th>角色</th><th>部门/职务</th><th>影响力</th><th>态度</th><th>关注重点</th></tr>`+
    list.map(s=>`<tr><td><b>${esc(s.name||'—')}</b></td><td>${esc(s.role||'—')}</td><td>${esc(s.dept||'—')} / ${esc(s.title||'—')}</td>
      <td>${influenceBadge(s.influence)}</td><td>${attitudeBadge(s.attitude)}</td><td>${esc(s.focus||'')}</td></tr>`).join('')+'</table>'
    :'<div class="empty">暂无干系人</div>'}
    <div style="margin-top:12px"><button class="btn" onclick="show('stakeholders')">前往干系人管理 →</button></div></div>`;
}
function renderDtContract(p){
  const c=store.contracts[p.id]||{attachments:[]};
  return `<div class="card"><h3>合同信息</h3>
    <div class="grid g4" style="font-size:13px">
      <div><span style="color:var(--sub)">合同编号</span><br><b>${esc(c.contractNo||'—')}</b></div>
      <div><span style="color:var(--sub)">合同金额</span><br><b>${c.amount!==undefined&&c.amount!==''?esc(c.amount)+' 万':'—'}</b></div>
      <div><span style="color:var(--sub)">签订日期</span><br><b>${esc(c.signDate||'—')}</b></div>
      <div><span style="color:var(--sub)">状态</span><br><b>${esc(c.status||'—')}</b></div>
    </div>
    <div style="margin-top:10px"><span style="color:var(--sub)">付款条款</span><br>${esc(c.paymentTerms||'—')}</div>
    <div style="margin-top:10px"><span style="color:var(--sub)">备注</span><br>${esc(c.notes||'—')}</div>
    ${(c.attachments||[]).length?`<div style="margin-top:12px"><b>合同附件</b><br>${c.attachments.map(a=>`<a href="/api/files/download/${encodeURIComponent(a.fileId)}" target="_blank">${esc(a.name)}</a>`).join('、')}</div>`:''}
    <div style="margin-top:12px"><button class="btn" onclick="show('contracts')">前往合同管理 →</button></div></div>`;
}

/* ================= 演示种子数据 ================= */
function seed(){
  if(store.projects.length||store.kb.length){return}
  const C=o=>Object.assign(defaultC139(),o||{});
  const mk=(id,name,customer,stage,oppLevel,sales,presales,amt,mon,c139,extra)=>Object.assign({
    id,name,customer,stage,oppLevel,sales,presales,
    amounts:{estTotal:amt[0]||0,software:amt[1]||0,won:amt[2]||0,cost:amt[3]||0},
    expectSignMonth:mon[0]||'',actualSignMonth:mon[1]||'',keyDate:mon[2]||'',
    source:'',progressText:'',lostReason:'',created:today(),c139:c139||C(),tasks:[],timeline:[],bg:{},docs:[]},extra||{});
  store.projects=[
    mk('p1','省农信社核心系统灾备建设项目','青海省农村信用社联合社','招投标阶段','控单','王强','李晓峰',
      [860,520,0,0],['2026-10','','2026-09-28'],
      C({coach:true,is1W:true,consensus:[true,true,true],factors:[true,true,true,true,true,true,true,true,false],note:'科技部处处长期待我方方案，招标参数已体现双活要求'}),
      {source:'一期维保关系转入，客户立项批复已下达',progressText:'已发标，9/28 开标；技术参数对我方有利，重点防低价搅局与答疑澄清。',
       bg:{why:'核心系统无异地灾备，监管要求 2026 年底前达到 RPO≤15 分钟',chain:'科技部（决策把关）→ 分管副主任（决策者）→ 运营管理部（使用方）',rival:'A公司（同城灾备一期承建商）；B公司（低价策略）'},
       tasks:[{title:'完成投标文件编制与内部评审',done:false},{title:'述标PPT与答疑分工',done:false},{title:'锁定参数偏离项应对口径',done:true}],
       timeline:[{d:today(),t:'拿到招标文件，C139 复评：控单'},{d:today(),t:'科技处沟通确认技术参数无排他风险'}]}),
    mk('p2','某银行信贷系统升级项目','青海银行','方案阶段','博弈','王强','陈晨',
      [480,320,0,0],['2026-12','',''],
      C({coach:true,consensus:[true,false,false],factors:[true,true,true,true,true,true,false,false,false]}),
      {source:'客户科技规划接触，原厂渠道获知',progressText:'完成两轮技术交流，等待预算批复；友商同步在推，需尽快建立教练校准信息。',
       tasks:[{title:'向信息科技部汇报升级方案',done:true},{title:'摸清竞品报价区间',done:false}],
       timeline:[{d:today(),t:'第二轮交流完成，客户关注平滑迁移与不停机切换'}]}),
    mk('p3','某市政务云二期建设项目','某市大数据管理局','已中标','控单','张磊','李晓峰',
      [860,500,796,608],['2026-07','2026-08','2026-06-20'],
      C({coach:true,is1W:true,consensus:[true,true,true],factors:[true,true,true,true,true,true,true,true,true],note:'信息中心王主任为教练，全程引导评分办法'}),
      {source:'一期维保 + 行业展会获知，二期预算列入财政计划',progressText:'已签约进入交付，回款按 3:6:1 执行；毛利 188 万（23.6%）。',
       bg:{why:'一期资源利用率低、跨部门数据共享难，领导要求统一算力与数据中枢',chain:'分管副局长（决策者）；大数据局局长（使用方代表）；信息中心王主任（技术把关，倾向我方）',rival:'A公司（一期承建商，有粘性）；B公司（低价策略）'},
       tasks:[{title:'中标复盘并沉淀评分办法经验',done:true},{title:'交付启动会与里程碑确认',done:false}],
       timeline:[{d:'2026-08-16',t:'完成合同签署，进入交付'},{d:'2026-06-25',t:'开标，综合评分第一'}]}),
    mk('p4','智慧园区综合管理平台','某园区管委会','前期交流','了解中','刘洋','陈晨',
      [260,150,0,0],['2027-03','',''],
      C({factors:[true,false,false,false,false,false,false,false,false]}),
      {source:'园区招商推介会认识管委会信息化科',progressText:'初次交流完成，等园区数字化规划初稿出来再判断真实预算与时间。'}),
    mk('p5','互联网医院平台建设项目','某三甲医院','已输标','博弈','张磊','李晓峰',
      [390,240,0,0],['2026-05','','2026-05-30'],
      C({consensus:[false,false,false],factors:[true,true,true,false,false,false,false,false,false]}),
      {lostReason:'报价高出中标人 12%，商务分差距过大；对手为一期承建商，客户关系深厚',progressText:'已完成复盘：报价策略与决策链覆盖不足，经验与竞品情报入知识库。',
       timeline:[{d:'2026-06-02',t:'开标失利，综合评分第三'}]}),
    mk('p6','政务云等保改造项目','某市行政审批局','项目已取消','了解中','刘洋','陈晨',
      [150,90,0,0],['2026-11','',''],
      C(),{lostReason:'客户预算削减，项目推迟至下一财政年度',progressText:'保持联系，明年初预算恢复后重新立项。'})
  ];
  const P=id=>store.projects.find(x=>x.id===id);
  P('p1').nextSteps=[
    {id:uid(),what:'确认答疑澄清提交窗口与偏离表口径',owner:'王强',due:addDays(today(),-1),done:false},
    {id:uid(),what:'完成投标技术标编制并内部评审',owner:'李晓峰',due:addDays(today(),2),done:false},
    {id:uid(),what:'拉通原厂报价，锁定成本红线',owner:'王强',due:addDays(today(),3),done:false},
    {id:uid(),what:'述标PPT初稿与答辩分工',owner:'李晓峰',due:addDays(today(),5),done:false}];
  P('p1').risks=[
    {id:uid(),kind:'风险',level:'高',desc:'B公司可能以低于成本价搅局，商务分被拉开',owner:'王强',mitigation:'申请价格评审策略；用五年 TCO 对比强化我方技术分权重',status:'开放',found:today()},
    {id:uid(),kind:'问题',level:'中',desc:'客户 RPO≤15 分钟硬性指标与我方标准双活方案存在差距',owner:'李晓峰',mitigation:'与研发确认改造工作量，本周给出书面答复',status:'跟踪中',found:today()}];
  P('p2').nextSteps=[
    {id:uid(),what:'向信息科技部汇报升级方案（分期建设路径）',owner:'陈晨',due:addDays(today(),4),done:false},
    {id:uid(),what:'通过教练摸清竞品报价区间',owner:'王强',due:addDays(today(),10),done:false}];
  P('p2').risks=[
    {id:uid(),kind:'风险',level:'高',desc:'客户预算仍在财政评审，项目可能延后一个季度',owner:'王强',mitigation:'推动科技部门先出技术选型报告，锁定立项节奏',status:'开放',found:today()}];
  P('p3').nextSteps=[
    {id:uid(),what:'交付启动会，确认里程碑与回款节点',owner:'张磊',due:addDays(today(),6),done:false}];
  P('p3').risks=[
    {id:uid(),kind:'风险',level:'低',desc:'硬件到货周期受产能影响，可能压缩实施窗口',owner:'张磊',mitigation:'合同约定到货节点，提前两周预警',status:'跟踪中',found:today()}];
  P('p5').risks=[
    {id:uid(),kind:'问题',level:'中',desc:'报价策略偏保守，商务分差距过大',owner:'张磊',mitigation:'复盘结论入知识库，同类项目预设三档报价',status:'已关闭',found:today()}];
  store.followups={
    p1:[{id:uid(),date:addDays(today(),-2),way:'会议',by:'李晓峰',content:'招标答疑预沟通：科技处确认 RPO≤15 分钟为硬性指标，接受双活方案；建议偏离表逐条响应，避免被判定负偏离。',next:addDays(today(),3)},
        {id:uid(),date:addDays(today(),-9),way:'拜访',by:'王强',content:'拜访运营管理部：一期同城灾备实际利用率不足 40%，客户希望异地方案兼顾开发测试环境复用。',next:''}],
    p2:[{id:uid(),date:addDays(today(),-5),way:'电话',by:'陈晨',content:'信息科技部反馈预算仍在财政评审，需等 10 月批复；建议方案给出分期建设路径，先上一期核心模块。',next:addDays(today(),4)}],
    p3:[{id:uid(),date:addDays(today(),-20),way:'邮件',by:'张磊',content:'发送中标通知书回执与合同文本，确认 8/16 签约，付款 3:6:1。',next:''}],
    p4:[{id:uid(),date:addDays(today(),-12),way:'拜访',by:'陈晨',content:'首次交流：管委会关注招商与能耗管理，信息化科无独立预算，需挂靠年度专项。',next:''}
  ]
  };
  store.tasks=[{id:'t1',projectId:'p3',type:'first',title:'某市政务云二期建设整体思路交流',autoTitle:true,status:'chat',qIndex:1,created:today(),ts:Date.now()-22e5,draft:null,
    answers:{theme:'某市政务云二期建设整体思路交流'},
    msgs:[
    {role:'ai',text:'您好！我是「售前交流专家」🎙️，本次任务由我负责为您编制《首次售前交流 PPT》。\n项目：某市政务云二期建设项目\n客户：某市大数据管理局 · 阶段：方案阶段 · C139 赢单率 22%',ts:Date.now()-9e5},
    {role:'ai',text:'我已从项目背景收集表自动带入：客户痛点/关注点。每到一问，您可直接采用带入内容、修改后发送，或让我用模板默认值。',ts:Date.now()-89e4},
    {role:'ai',text:'【第1/5问 · 交流主题】\n提示：如：XX客户数字化转型整体思路\n请输入内容，或点击下方快捷选项。',ts:Date.now()-88e4},
    {role:'me',text:'某市政务云二期建设整体思路交流',ts:Date.now()-87e4},
    {role:'ai',text:'收到 ✓',ts:Date.now()-86e4},
    {role:'ai',text:'【第2/5问 · 客户痛点/关注点】\n提示：来自背景收集表\n\n我已从项目背景带入：\n「一期资源利用率低、跨部门数据共享难，领导要求二期实现统一算力与数据中枢」\n可直接点击「采用带入背景」，或输入您的补充/修改。',ts:Date.now()-85e4}]}];
  store.kbTree=DEF_CATS.map(n=>({id:uid(),name:n,pid:null}));
  const catOf=name=>(store.kbTree.find(x=>x.name===name)||{}).id||null;
  store.kb=[
    {id:'k1',title:'我司政务云解决方案白皮书（摘要）',catId:catOf('产品资料'),tags:['政务云','白皮书'],content:'一云多芯、统一算力调度、数据共享交换平台、等保三级合规。核心指标：资源利用率提升40%，跨部门数据共享T+1→T+0。',date:today()},
    {id:'k2',title:'标杆案例：省会城市X政务云',catId:catOf('案例库'),tags:['政务云','案例','标杆'],content:'2024年建成，服务68个委办局，承载1200+业务系统，双十一式高峰零故障，获省级优秀案例。可提供现场参观。',date:today()},
    {id:'k3',title:'A公司竞争情报',catId:catOf('竞品情报'),tags:['A公司','竞争'],content:'优势：一期承建粘性、本地团队大。劣势：多云纳管能力弱、报价高、二期有资源利用率投诉。应对：主打一云多芯开放架构+利用率承诺SLA。',date:today()}];
  store.pdocs={p3:{input:[{id:uid(),name:'政务云二期需求建议书（客户邮件附件）',kind:'PDF',size:0,date:today(),from:'登记',note:'客户信息中心发送 v1.2',content:''}],process:{folders:[{id:'f1',name:'调研记录',docs:[{id:uid(),name:'信息中心王主任访谈纪要',kind:'MD',size:0,date:today(),from:'上传',note:'2026-08 现场调研',content:'要点：一期利用率不足35%；二期考核指标为跨部门共享率；副局长关注自主可控。'}]}],docs:[]},output:[],ref:[{id:uid(),name:'GB/T 政务云安全要求',kind:'PDF',size:0,date:today(),from:'登记',note:'标准规范参考',content:''}]}};
  store.stakeholders={p3:[
    {id:uid(),name:'王建国',title:'信息中心主任',dept:'市大数据局',role:'技术把关',influence:'high',attitude:'support',phone:'138****1234',email:'wang@example.gov',focus:'自主可控、资源利用率、后续运维便利性',notes:'可发展为教练，多次透露友商弱点',updated:today()},
    {id:uid(),name:'李副局长',title:'副局长',dept:'市大数据局',role:'决策者',influence:'high',attitude:'neutral',phone:'',email:'',focus:'政绩、预算可控、风险低',notes:'尚未直接交流，需通过王主任安排',updated:today()}
  ]};
  store.contracts={p3:{contractNo:'HT-2026-ZWYC-002',amount:796,signDate:'2026-08-16',endDate:'2027-10-15',paymentTerms:'3:6:1',status:'已签署',notes:'按招标文件付款条款，预留 10% 质保金一年',attachments:[]}};
  store.quotations={p3:[
    {id:uid(),name:'V1 初版报价',date:today(),status:'草稿',notes:'含软硬件、实施、三年维保',excelFile:null,
     items:[{name:'云平台软件授权',qty:1,cost:120,quote:180,remark:'含一云多芯、算力调度'},
            {name:'硬件服务器',qty:8,cost:240,quote:320,remark:'信创服务器'},
            {name:'实施与集成',qty:1,cost:80,quote:120,remark:'90天交付'},
            {name:'三年维保',qty:1,cost:60,quote:90,remark:'7×24'}]}
  ]};
  store.compintel=[
    {id:uid(),competitor:'A公司',projectId:'p3',product:'政务云一期续建方案',price:920,source:'客户透露/公开中标公告',date:today(),
     strategy:'强调一期粘性与迁移成本，承诺免费平滑升级',strengths:'一期承建商，数据迁移风险低，客户关系深',weaknesses:'多云纳管能力弱，二期扩容报价高，一期利用率投诉未解决'},
    {id:uid(),competitor:'B公司',projectId:'p1',product:'异地灾备低价方案',price:610,source:'同业交流',date:today(),
     strategy:'以低价切入，后续再收维保费',strengths:'价格灵活，本地有代理',weaknesses:'无金融行业双活案例，RPO 指标达不到监管口径'}
  ];
  store.requirements={p3:[
    {id:uid(),title:'跨部门数据共享T+0',category:'业务需求',priority:'high',status:'analyzed',source:'招标文件 / 客户访谈',relatedKb:'标杆案例：省会城市X政务云',
     description:'打破委办局数据壁垒，实现跨部门共享实时可达',analysis:'我方数据共享交换平台已验证，T+0 能力可支持；需在方案中给出架构图与性能指标'},
    {id:uid(),title:'一云多芯统一纳管',category:'非功能需求',priority:'high',status:'pending',source:'招标文件',relatedKb:'我司政务云解决方案白皮书',
     description:'支持鲲鹏、海光、飞腾等多种芯片架构的统一管理与调度',analysis:''}
  ]};
  persist();
}

/* ================= 服务端落库同步（store → BFF /api/state → SQLite） =================
 * 事实来源在服务器；localStorage 降级为「秒开缓存 + 断网兜底」。原 49 处 persist() 调用点一行不改。
 * 粒度：store 的每个顶层集合 = state 表一行，只推内容变了的集合（800ms 去抖 + 串行，避免互相抢写）。
 * 判定（boot 与轮询同一套规则）：
 *   1) 本机与库内容一致                    → 不动
 *   2) 本机内容 == 上次同步成功的快照       → 本机没改过，跟随库（同事的改动拉下来）
 *   3) 其余（本机改过 / 首次上云 / 本机把该集合清空）→ 以本机为准上传
 * 覆盖库之前会把本机全量快照存进 localStorage['presales_workbench_v1_legacy']（每会话一次），防误覆盖。
 * rev 冲突（拉到数据与写回之间同事又改了）→ 提示后强制覆盖，服务器 rev +1。
 */
var SYNC_COLLECTIONS=['projects','kb','docs','tasks','kbTree','pdocs','checklists','stakeholders','contracts','quotations','compintel','requirements','followups'];
var SYNC_LABEL={projects:'项目',kb:'知识库',docs:'方案文档',tasks:'任务',kbTree:'知识库目录',pdocs:'项目资料',checklists:'检查清单',stakeholders:'干系人',contracts:'合同',quotations:'报价',compintel:'竞争情报',requirements:'需求',followups:'跟进记录'};
var SYNC_POLL_MS=60000;
var _rev={}, _sent={}, _online=false, _lastErr='', _pushTimer=null, _pushing=false, _pushAgain=false, _legacyGuard=false;
// 浏览器实例标识：无鉴权场景下写进库的 updated_by，出问题时能区分是哪台机器写的
var CLIENT_TAG=(function(){try{var v=localStorage.getItem('pw_client');if(!v){v='c'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);localStorage.setItem('pw_client',v)}return v}catch(e){return 'anon'}})();

function _j(v){return JSON.stringify(v===undefined?null:v)}
function _empty(v){if(v==null)return true;if(Array.isArray(v))return v.length===0;if(typeof v==='object')return Object.keys(v).length===0;return false}
function _dirtyNow(k){return _sent[k]!==_j(store[k])}
function _pendingKeys(){var a=[];for(var i=0;i<SYNC_COLLECTIONS.length;i++){if(_dirtyNow(SYNC_COLLECTIONS[i]))a.push(SYNC_COLLECTIONS[i])}return a}
function _markSynced(){for(var i=0;i<SYNC_COLLECTIONS.length;i++){var k=SYNC_COLLECTIONS[i];_sent[k]=_j(store[k])}}
function _guardLegacy(){if(_legacyGuard)return;_legacyGuard=true;try{localStorage.setItem('presales_workbench_v1_legacy',_j({savedAt:new Date().toISOString(),store:store}))}catch(e){}}
function currentPage(){var el=document.querySelector('.page.on');return el?el.id.slice(2):'dash'}
function rerender(){try{show(currentPage())}catch(e){}}

function schedulePush(){clearTimeout(_pushTimer);_pushTimer=setTimeout(function(){pushChanged()},800);renderSyncState()}

async function pushChanged(){
  if(_pushing){_pushAgain=true;return}
  _pushing=true;renderSyncState();
  try{
    for(var i=0;i<SYNC_COLLECTIONS.length;i++){
      var k=SYNC_COLLECTIONS[i];
      var payload=_j(store[k]);
      if(_sent[k]===payload)continue;
      var ok=await pushOne(k,payload,false);
      // 推送期间内容又变了就不更新快照，下一轮继续推
      if(ok&&_j(store[k])===payload)_sent[k]=payload;
    }
  }finally{_pushing=false}
  if(_pushAgain){_pushAgain=false;schedulePush()}
  renderSyncState();
}

async function pushOne(k,payload,force){
  var body={data:JSON.parse(payload),by:CLIENT_TAG};
  if(!force&&_rev[k]!=null)body.rev=_rev[k];
  if(force)body.force=true;
  try{
    var r=await fetch('/api/state/'+encodeURIComponent(k),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    if(r.status===409){
      toast('「'+(SYNC_LABEL[k]||k)+'」同事刚改过，已按你这份覆盖');
      r=await fetch('/api/state/'+encodeURIComponent(k),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({data:JSON.parse(payload),by:CLIENT_TAG,force:true})});
    }
    if(!r.ok){var ej=await r.json().catch(function(){return {}});throw new Error(ej.error||('HTTP '+r.status))}
    var j=await r.json();
    _rev[k]=j.rev;_online=true;_lastErr='';
    return true;
  }catch(e){
    _online=false;_lastErr=(e&&e.message)||'写入失败';
    toast('保存到服务器失败：'+_lastErr+'（本机已留缓存，可点「立即同步」重试）');
    renderSyncState();
    return false;
  }
}

/** 拉服务器数据并按规则双向同步；isBoot 时不做「同事改动」提示 */
async function pullState(isBoot){
  var r=null;
  try{r=await fetch(isBoot?'/api/state':'/api/state?meta=1',{cache:'no-store'})}catch(e){_online=false;_lastErr='网络不可达';renderSyncState();return}
  if(!r||!r.ok){_online=false;_lastErr='HTTP '+(r?r.status:'?');renderSyncState();return}
  var j=await r.json().catch(function(){return null});
  if(!j||!j.states){_online=false;_lastErr='响应异常';renderSyncState();return}
  _online=true;_lastErr='';
  var st=j.states, ups=[], downs=[];
  if(isBoot){
    // 全量比对：库里内容缺失/为空而本机非空 → 上传（首次上云）；本机没改过 → 跟随库；本机改过 → 上传
    for(var i=0;i<SYNC_COLLECTIONS.length;i++){
      var k=SYNC_COLLECTIONS[i], row=st[k], loc=store[k];
      if(row)_rev[k]=row.rev;
      var locJ=_j(loc), srvJ=row?_j(row.data):null;
      if(row&&locJ===srvJ)continue;                                              // 1 内容一致 → 不动
      if((!row||_empty(row.data))&&!_empty(loc)){ups.push(k);continue}           // 2 库里空/缺失 → 本机上传
      if(_sent[k]!==undefined&&locJ===_sent[k]){if(row)downs.push(k);continue}   // 3 本机没改过 → 跟随库
      if(!_empty(loc)||_sent[k]!==undefined)ups.push(k);                         // 4 本机改过（含主动清空）→ 上传
      else if(row&&!_empty(row.data))downs.push(k);                              // 5 本机确实空 → 用库
    }
    if(downs.length){_guardLegacy();for(var d=0;d<downs.length;d++){var kd=downs[d];store[kd]=st[kd].data;_sent[kd]=_j(store[kd])}}
    for(var u=0;u<ups.length;u++){var ku=ups[u];var pay=_j(store[ku]);if(await pushOne(ku,pay,true))_sent[ku]=pay}
  }else{
    // 轮询：只比 rev。本机有改动 → 带 rev 上传（服务器 rev 更新则 409 → 提示后覆盖）；本机干净但库变了 → 只下载这些集合
    for(var i2=0;i2<SYNC_COLLECTIONS.length;i2++){
      var k2=SYNC_COLLECTIONS[i2], row2=st[k2];
      if(_dirtyNow(k2)){var pay2=_j(store[k2]);if(await pushOne(k2,pay2,false))_sent[k2]=pay2;continue}
      if(!row2||_sent[k2]===undefined)continue;
      if(_rev[k2]===undefined||row2.rev!==_rev[k2])downs.push(k2);
    }
    if(downs.length)await downloadKeys(downs);
  }
  if(downs.length){rerender();if(!isBoot)toast('已同步同事的最新数据')}
  renderSyncState();
}

/** 精准下载若干集合（轮询用，避免重复拉全量） */
async function downloadKeys(keys){
  try{
    var r=await fetch('/api/state?keys='+encodeURIComponent(keys.join(',')),{cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    var j=await r.json();
    _guardLegacy();
    for(var i=0;i<keys.length;i++){
      var k=keys[i], row=j.states&&j.states[k];
      if(!row)continue;
      store[k]=row.data;_sent[k]=_j(row.data);_rev[k]=row.rev;
    }
  }catch(e){_lastErr=(e&&e.message)||'下载失败';renderSyncState()}
}

function syncNow(){pullState(false).then(function(){return pushChanged()}).then(function(){toast('已同步')})}

/** 导入备份后整体落库：一次批量强制写入，避免逐集合撞 rev */
async function pushImportToServer(){
  var states={};
  for(var i=0;i<SYNC_COLLECTIONS.length;i++){var k=SYNC_COLLECTIONS[i];states[k]=store[k]===undefined?null:store[k]}
  try{
    var r=await fetch('/api/state/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({states:states,by:CLIENT_TAG})});
    if(!r.ok)throw new Error('HTTP '+r.status);
    var j=await r.json();
    for(var w=0;w<(j.written||[]).length;w++){var wk=j.written[w];_rev[wk.key]=wk.rev;_sent[wk.key]=_j(store[wk.key])}
    _online=true;_lastErr='';toast('导入数据已存入服务器');renderSyncState();
  }catch(e){_online=false;_lastErr=(e&&e.message)||'写入失败';toast('导入数据上传失败（本机已生效）：'+_lastErr+'，可点「立即同步」重试');renderSyncState()}
}

function renderSyncState(){
  var el=document.getElementById('syncState');if(!el)return;
  var pend=_pendingKeys().length;
  var txt,color;
  if(!_online){txt='离线·仅存本机'+(_lastErr?('（'+_lastErr+'）'):'');color='#e0a800'}
  else if(_pushing){txt='同步中…';color='#4a90d9'}
  else if(pend){txt='待同步 '+pend+' 项';color='#e0a800'}
  else {txt='已同步';color='#2e9e5b'}
  el.textContent='● '+txt;el.style.color=color;
  el.title=_online?('业务数据存服务器 SQLite；本机浏览器另有缓存。'+(pend?'还有 '+pend+' 个集合未上传':'全部已上传'))
    :('服务器暂不可达（'+_lastErr+'），数据先存本机，恢复后自动补传');
}

/* ================= 启动 ================= */
load();seed();renderDash();renderProjects();
_markSynced();                       // 先把本机现状当作「已同步基线」，之后的差异才算改动
pullState(true).then(function(){
  setInterval(function(){if(!document.hidden)pullState(false)},SYNC_POLL_MS);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)pullState(false)});
});
