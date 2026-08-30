
/* ================= 数据层 ================= */
const LS_KEY='presales_workbench_v1';
let store={projects:[],kb:[],docs:[],tasks:[],kbTree:[],pdocs:{},checklists:{}};
let editingProjectId=null, currentProjectId=null, kbEditingId=null;

const DEF_CATS=['产品资料','案例库','技术方案素材','公司资质与实力','竞品情报','话术与FAQ','模板与规范'];
function persist(){try{localStorage.setItem(LS_KEY,JSON.stringify(store))}catch(e){}}
function load(){try{const s=localStorage.getItem(LS_KEY);if(s)store=JSON.parse(s)}catch(e){}
  if(!store.projects)store={projects:[],kb:[],docs:[],tasks:[],kbTree:[],pdocs:{},checklists:{}};
  if(!store.tasks)store.tasks=[];if(!store.docs)store.docs=[];if(!store.checklists)store.checklists={};
  if(!store.pdocs)store.pdocs={};
  if(!store.kbTree||!store.kbTree.length){
    store.kbTree=DEF_CATS.map(n=>({id:uid(),name:n,pid:null}));
    store.kb.forEach(k=>{if(k.category!==undefined){const n=store.kbTree.find(t=>t.name===k.category);k.catId=n?n.id:null;delete k.category}});
  }}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function today(){return new Date().toISOString().slice(0,10)}
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
}
document.getElementById('nav').addEventListener('click',e=>{const b=e.target.closest('button[data-p]');if(b)show(b.dataset.p)});
function closeMask(id){document.getElementById(id).classList.remove('on')}
function openMask(id){document.getElementById(id).classList.add('on')}

/* ================= 项目管理 ================= */
const STAGES=['前期交流','方案阶段','招投标阶段','已中标'];
const STAGE_CLS={'前期交流':'b-pre','方案阶段':'b-plan','招投标阶段':'b-bid','已中标':'b-win','已流标':'b-fail','已输标':'b-lose'};
function stageBadge(s){return `<span class="badge ${STAGE_CLS[s]||'b-fail'}">${esc(s)}</span>`}

function openProjectModal(id){
  editingProjectId=id||null;
  const p=id?store.projects.find(x=>x.id===id):null;
  document.getElementById('pmTitle').textContent=p?'编辑项目':'新建项目';
  pfName.value=p?p.name:'';pfCust.value=p?p.customer:'';pfStage.value=p?p.stage:'前期交流';
  pfBudget.value=p?p.budget:'';pfOwner.value=p?p.owner:'';pfDate.value=p?p.keyDate:'';pfBg.value=p?p.source:'';
  openMask('mProject');
}
function saveProject(){
  if(!pfName.value.trim()||!pfCust.value.trim()){toast('请填写项目名称与客户名称');return}
  if(editingProjectId){
    const p=store.projects.find(x=>x.id===editingProjectId);
    Object.assign(p,{name:pfName.value.trim(),customer:pfCust.value.trim(),stage:pfStage.value,budget:pfBudget.value,owner:pfOwner.value,keyDate:pfDate.value,source:pfBg.value});
    addTl(p,'更新项目基本信息');
  }else{
    const p={id:uid(),name:pfName.value.trim(),customer:pfCust.value.trim(),stage:pfStage.value,budget:pfBudget.value,owner:pfOwner.value,keyDate:pfDate.value,source:pfBg.value,created:today(),c139:defaultC139(),tasks:[],timeline:[],bg:{},docs:[]};
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
  if(!list.length){t.innerHTML='<tr><td colspan="8"><div class="empty">暂无项目，点击右上角「新建项目」开始</div></td></tr>';return}
  t.innerHTML=`<tr><th>项目</th><th>客户</th><th>阶段</th><th>预算(万)</th><th>负责人</th><th>C139赢单率</th><th>关键日期</th><th style="width:170px">操作</th></tr>`+
  list.map(p=>{const s=c139Stats(p.c139);return `<tr>
    <td><b style="cursor:pointer;color:var(--brand)" onclick="openDetail('${p.id}')">${esc(p.name)}</b></td>
    <td>${esc(p.customer)}</td><td>${stageBadge(p.stage)}</td><td>${esc(p.budget||'—')}</td><td>${esc(p.owner||'—')}</td>
    <td><div class="wr"><span class="pct" style="color:${s.rate>=85?'var(--ok)':s.rate>=50?'#b25e0c':'var(--bad)'}">${s.rate}%</span>${zoneBadge(s.zone)}</div></td>
    <td>${esc(p.keyDate||'—')}</td>
    <td><button class="btn sm ghost" onclick="openDetail('${p.id}')">详情</button>
        <button class="btn sm ghost" onclick="openProjectModal('${p.id}')">编辑</button>
        <button class="btn sm danger" onclick="delProject('${p.id}')">删除</button></td></tr>`}).join('');
}
function filterStage(s){document.getElementById('projStageFilter').value=s;renderProjects()}

/* ================= 项目详情 ================= */
let dtTab='info';
function openDetail(id){currentProjectId=id;dtTab='info';show('detail');renderDetail()}
function getProj(id){return store.projects.find(p=>p.id===(id||currentProjectId))}
function changeStage(v){const p=getProj();if(!p)return;p.stage=v;addTl(p,'阶段变更为「'+v+'」');persist();renderDetail();show('detail')}
function renderDetail(){
  const p=getProj();if(!p){show('projects');return}
  document.getElementById('dtTitle').textContent=p.name;
  const s=c139Stats(p.c139);
  document.getElementById('dtSub').innerHTML=`${esc(p.customer)} · 预算 ${esc(p.budget||'—')} 万 · 负责人 ${esc(p.owner||'—')} · C139赢单率 <b>${s.rate}%</b> ${zoneBadge(s.zone)}`;
  document.getElementById('dtStage').value=p.stage;
  const order=['前期交流','方案阶段','招投标阶段','已中标'];
  const ci=order.indexOf(p.stage);
  document.getElementById('dtFlow').innerHTML=order.map((st,i)=>{
    const cls=p.stage==='已流标'||p.stage==='已输标'?(i<=2?'done':''):(i<ci?'done':i===ci?'cur':'');
    return `<div class="step ${cls}"><div class="dot">${i<ci?'✓':i+1}</div>${st}</div>`}).join('')+
    (p.stage==='已流标'||p.stage==='已输标'?`<div class="step cur"><div class="dot" style="background:${p.stage==='已中标'?'var(--ok)':'var(--bad)'};color:#fff">✕</div>${p.stage}</div>`:'');
  document.querySelectorAll('#dtTabs button').forEach(b=>b.classList.toggle('on',b.dataset.t===dtTab));
  document.getElementById('dtBody').innerHTML=({renderDtInfo,renderDtTask,renderDtTl,renderDtC139,renderDtDoc})[
    {info:'renderDtInfo',task:'renderDtTask',tl:'renderDtTl',c:'renderDtC139',doc:'renderDtDoc'}[dtTab]](p);
}
document.getElementById('dtTabs').addEventListener('click',e=>{const b=e.target.closest('button');if(b){dtTab=b.dataset.t;renderDetail()}});

const BG_FIELDS=[
 ['org','客户组织架构 / 信息化现状'],['why','立项原因与业务痛点'],['chain','决策链与关键人（角色/立场/诉求）'],
 ['money','预算与资金来源'],['buy','采购方式与流程（招标/竞谈/单一来源）'],['rival','竞争对手情况（各家动作/优劣势）'],
 ['swot','我方 SWOT 分析'],['ksf','KSF 关键成功要素'],['nodes','关键时间节点（调研/交流/招标/上线）']];
function renderDtInfo(p){
  p.bg=p.bg||{};
  return `<div class="card"><h3>项目基本信息</h3><div class="grid g4" style="font-size:13px">
    <div><span style="color:var(--sub)">客户</span><br><b>${esc(p.customer)}</b></div>
    <div><span style="color:var(--sub)">预算</span><br><b>${esc(p.budget||'—')} 万</b></div>
    <div><span style="color:var(--sub)">负责人</span><br><b>${esc(p.owner||'—')}</b></div>
    <div><span style="color:var(--sub)">创建日期</span><br><b>${esc(p.created||'—')}</b></div></div>
    <div style="margin-top:10px"><span style="color:var(--sub)">项目来源</span><br>${esc(p.source||'—')}</div></div>
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
function catOptions(){return (store.kbTree||[]).map(n=>{let d=0,p=n.pid;while(p){d++;const q=(store.kbTree||[]).find(x=>x.id===p);p=q?q.pid:null}return `<option value="${n.id}">${'　'.repeat(d)}${esc(n.name)}</option>`}).join('')}
function addCatNode(pid){const name=prompt((pid?'在「'+catName(pid)+'」下':'根级')+'新建目录名称：');if(!name||!name.trim())return;store.kbTree.push({id:uid(),name:name.trim(),pid:pid||null});persist();renderKb();toast('目录已创建')}
function renameCatNode(id){const n=store.kbTree.find(x=>x.id===id);const name=prompt('重命名目录：',n.name);if(!name||!name.trim())return;n.name=name.trim();persist();renderKb()}
function delCatNode(id){const n=store.kbTree.find(x=>x.id===id);if(!confirm('删除目录「'+n.name+'」？\n子目录上提一层，目录内知识移至上级'))return;childrenOf(id).forEach(k=>k.pid=n.pid);store.kb.forEach(k=>{if(k.catId===id)k.catId=n.pid||null});store.kbTree=store.kbTree.filter(x=>x.id!==id);if(kbSelCat===id)kbSelCat=n.pid||'all';persist();renderKb()}
function kbCount(id){return store.kb.filter(k=>id==='all'?true:descIds(id).includes(k.catId)).length}
function nodeHtml(n,depth){
  const kids=childrenOf(n.id);
  return `<div class="tnode ${kbSelCat===n.id?'on':''}" style="padding-left:${8+depth*14}px" onclick="kbSelCat='${n.id}';renderKb()">
    <span>📁 ${esc(n.name)}</span><b class="tc">${kbCount(n.id)}</b>
    <span class="tnode-ops"><button title="新建子目录" onclick="event.stopPropagation();addCatNode('${n.id}')">＋</button><button title="重命名" onclick="event.stopPropagation();renameCatNode('${n.id}')">✎</button><button title="删除" onclick="event.stopPropagation();delCatNode('${n.id}')">✕</button></span></div>`+
    kids.map(k=>nodeHtml(k,depth+1)).join('');
}
function renderKbTree(){
  document.getElementById('kbTree').innerHTML=
    `<div class="tnode ${kbSelCat==='all'?'on':''}" onclick="kbSelCat='all';renderKb()"><span>📚 全部知识</span><b class="tc">${kbCount('all')}</b></div>`+
    childrenOf(null).map(n=>nodeHtml(n,0)).join('');
}
function renderKb(){
  if(!document.getElementById('kbTree'))return;
  renderKbTree();
  const vec=store.kb.filter(k=>k.segs&&k.segs.length).length;
  document.getElementById('kbCrumb').innerHTML=`当前目录：<b>${kbSelCat==='all'?'全部知识':esc(catName(kbSelCat))}</b> · 共 ${kbCount(kbSelCat)} 条，其中已向量化 ${store.kb.filter(k=>k.segs&&k.segs.length&&(kbSelCat==='all'||descIds(kbSelCat).includes(k.catId))).length} 条 · 将来对接真实向量库后，此处展示 embedding 模型与索引状态`;
  const kw=(document.getElementById('kbSearch').value||'').toLowerCase().split(/\s+/).filter(Boolean);
  const ids=kbSelCat==='all'?null:descIds(kbSelCat);
  let list=store.kb.filter(k=>!ids||ids.includes(k.catId));
  list=kw.length?list.map(k=>({k,s:kbScore(k,kw)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).map(x=>x.k):list;
  const el=document.getElementById('kbList');
  if(!list.length){el.innerHTML='<div class="empty">'+(kw.length?'没有匹配知识，试试更换关键词':'当前目录暂无知识<br>点击右上角「🚀 添加内容 · 向量化入库」体验四步入库流程')+'</div>';return}
  el.innerHTML=list.map(k=>`<div class="kb-item">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b>${esc(k.title)}</b><span class="tag">📁 ${esc(catName(k.catId))}</span>
      ${k.segs&&k.segs.length?`<span class="tag" style="background:#e6f4ea;color:var(--ok)">⚡ 已向量化 · ${k.segs.length} 分段</span>`:''}
      ${k.file?`<span class="tag">📎 ${esc(k.file)}</span>`:''}
      <div style="flex:1"></div>
      <button class="btn sm ghost" onclick="openKbModal('${k.id}')">编辑</button>
      <button class="btn sm ghost" onclick="navigator.clipboard.writeText(store.kb.find(x=>x.id==='${k.id}').content);toast('已复制内容')">复制</button>
      <button class="btn sm danger" onclick="delKb('${k.id}')">删除</button></div>
    <div class="meta">${k.tags.map(t=>'#'+esc(t)).join(' ')} · ${esc(k.date||'')}</div>
    <div class="body">${esc(k.content.slice(0,600))}${k.content.length>600?' …':''}</div></div>`).join('');
}
function openKbModal(id){
  kbEditingId=id||null;const k=id?store.kb.find(x=>x.id===id):null;
  document.getElementById('kbTitle').textContent=k?'编辑知识':'新增知识';
  kfName.value=k?k.title:'';
  kfCat.innerHTML='<option value="">（未分类）</option>'+catOptions();
  kfCat.value=k?(k.catId||''):(kbSelCat==='all'?'':kbSelCat);
  kfTags.value=k?k.tags.join(','):'';kfBody.value=k?k.content:'';
  openMask('mKb');
}
function saveKb(){
  if(!kfName.value.trim()||!kfBody.value.trim()){toast('请填写标题与内容');return}
  const tags=kfTags.value.split(/[,，]/).map(s=>s.trim()).filter(Boolean);
  if(kbEditingId){const k=store.kb.find(x=>x.id===kbEditingId);Object.assign(k,{title:kfName.value.trim(),catId:kfCat.value||null,tags,content:kfBody.value})}
  else store.kb.unshift({id:uid(),title:kfName.value.trim(),catId:kfCat.value||null,tags,content:kfBody.value,date:today()});
  persist();closeMask('mKb');renderKb();toast('已保存')
}
function delKb(id){if(!confirm('删除该知识？'))return;store.kb=store.kb.filter(k=>k.id!==id);persist();renderKb()}
function defaultCat(){return kbSelCat!=='all'?kbSelCat:(childrenOf(null)[0]||{}).id||null}
function kbUploadFiles(inp){
  [...inp.files].forEach(f=>{
    const ext=f.name.split('.').pop().toLowerCase();
    if(['txt','md','csv','json','log'].includes(ext)){
      const r=new FileReader();r.onload=()=>{
        store.kb.unshift({id:uid(),title:f.name.replace(/\.[^.]+$/,''),catId:defaultCat(),tags:['文件上传'],content:r.result.slice(0,20000),date:today(),file:f.name});
        persist();renderKb();toast(`「${f.name}」已解析入库`)};
      r.readAsText(f,'utf-8');
    }else{
      store.kb.unshift({id:uid(),title:f.name.replace(/\.[^.]+$/,''),catId:defaultCat(),tags:['文件上传','未解析'],content:'（'+f.name+' 为二进制文件，本地原型暂不解析。建议走「🚀 添加内容」向导登记，或升级在线版接入文档解析与向量化。）',date:today(),file:f.name});
      persist();renderKb();toast(`「${f.name}」已登记（内容未解析）`)}
  });
  inp.value='';
}
function kbScore(k,words){
  let sc=0;const title=k.title.toLowerCase(),tags=k.tags.join(' ').toLowerCase(),body=k.content.toLowerCase();
  words.forEach(w=>{if(title.includes(w))sc+=5;if(tags.includes(w))sc+=3;if(body.includes(w))sc+=1});
  return sc;
}

/* ---- 四步向量化入库向导（参照扣子流程） ---- */
let wz=null,wzTimer=null;
function openWizard(){wz={files:[],step:1,parse:'precise',ext:{img:true,ocr:true,table:true},filterTxt:'',segMode:'auto',segLen:500,cur:0};renderWz();openMask('mWizard')}
function renderWz(){
  if(!wz)return;
  const names=['上传','创建设置','分段预览','数据处理'];
  document.getElementById('wzSteps').innerHTML=names.map((n,i)=>{const s=i+1;return `<div class="ws ${s===wz.step?'on':s<wz.step?'ok':''}"><i>${s<wz.step?'✓':s}</i>${n}</div>`}).join('');
  document.getElementById('wzBody').innerHTML=[wzS1,wzS2,wzS3,wzS4][wz.step-1]();
  document.getElementById('wzPrevBtn').style.visibility=wz.step>1&&wz.step<4?'visible':'hidden';
  const nb=document.getElementById('wzNextBtn');
  nb.textContent=wz.step===4?(wz.allDone?'确认入库':'处理中…'):'下一步';
  nb.disabled=(wz.step===1&&!wz.files.length)||(wz.step===4&&!wz.allDone);
}
function wzS1(){
  return `<div class="drop" id="wzDrop" onclick="document.getElementById('wzFile').click()"
    ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')"
    ondrop="event.preventDefault();this.classList.remove('over');wzHandle(event.dataTransfer.files)">
    <span class="up">⬆</span>点击上传或拖拽文档到这里<br>
    <small>支持 PDF、TXT、DOC、DOCX、MD，最多可上传 300 个文件，每个文件不超过 100MB，PDF 最多 500 页（本地原型仅解析文本类，其余登记元数据）</small>
    <input type="file" id="wzFile" multiple style="display:none" onchange="wzHandle(this.files)"></div>
    <div style="margin-top:12px">${wz.files.map((f,i)=>`<div class="kb-item" style="display:flex;align-items:center;gap:10px;padding:9px 12px"><span>${['📄','📝','📊','📦'][Math.min(3,['txt','md','csv','json'].includes(f.ext)?0:['doc','docx'].includes(f.ext)?1:['xls','xlsx'].includes(f.ext)?2:3)]}</span>
      <b style="flex:1">${esc(f.name)}</b><span class="tag">${fmtSize(f.size)}</span><span class="tag">${f.text?f.text.length+' 字符已提取':(['txt','md','csv','json','log'].includes(f.ext)?'读取中…':'待在线解析')}</span>
      <button class="btn sm danger" onclick="wz.files.splice(${i},1);renderWz()">✕</button></div>`).join('')}</div>`;
}
function wzHandle(fl){
  [...fl].forEach(f=>{
    const ext=f.name.split('.').pop().toLowerCase();
    const file={name:f.name,size:f.size,ext,text:''};
    wz.files.push(file);
    if(['txt','md','csv','json','log'].includes(ext)){const r=new FileReader();r.onload=()=>{file.text=r.result;renderWz()};r.readAsText(f,'utf-8')}
  });
  renderWz();
}
function wzS2(){
  return `<div class="hint">📁 本次入库目录：${kbSelCat==='all'?'（当前未选中具体目录，将放入第一个根目录；可先关闭向导在左侧目录树选择）':'「'+esc(catName(kbSelCat))+'」'}</div>
  <div style="font-weight:700;margin:14px 0 8px">文档解析策略</div>
  <div class="wz-opt ${wz.parse==='precise'?'on':''}" onclick="wz.parse='precise';renderWz()"><b>精准解析</b><p>将从文档中提取图片、表格等元素，需要耗费更长的时间</p>
    ${wz.parse==='precise'?`<div style="margin-top:10px;border-top:1px dashed var(--line);padding-top:10px">
      <b style="font-size:12.5px">提取内容</b><br>
      <label style="font-size:12.5px"><input type="checkbox" style="width:auto" ${wz.ext.img?'checked':''} onchange="wz.ext.img=this.checked"> 图片元素</label>&nbsp;
      <label style="font-size:12.5px"><input type="checkbox" style="width:auto" ${wz.ext.ocr?'checked':''} onchange="wz.ext.ocr=this.checked"> 扫描件（OCR）</label>&nbsp;
      <label style="font-size:12.5px"><input type="checkbox" style="width:auto" ${wz.ext.table?'checked':''} onchange="wz.ext.table=this.checked"> 表格元素</label>
      <div style="margin-top:8px"><b style="font-size:12.5px">内容过滤（正则，可留空）</b>
      <input placeholder="如：删除所有链接可填 https?://\\S+" value="${esc(wz.filterTxt)}" onchange="wz.filterTxt=this.value" style="margin-top:4px"></div></div>`:''}
  </div>
  <div class="wz-opt ${wz.parse==='fast'?'on':''}" onclick="wz.parse='fast';renderWz()"><b>快速解析</b><p>不会对文档提取图像、表格等元素，适用于纯文本</p></div>
  <div style="font-weight:700;margin:14px 0 8px">分段策略</div>
  <div class="wz-opt ${wz.segMode==='auto'?'on':''}" onclick="wz.segMode='auto';renderWz()"><b>自动分段与清洗</b><p>自动分段与预处理规则（按空行/句末换行切分，合并至约 ${wz.segLen} 字）</p></div>
  <div class="wz-opt ${wz.segMode==='custom'?'on':''}" onclick="wz.segMode='custom';renderWz()"><b>自定义</b><p>按固定长度切分</p>
    ${wz.segMode==='custom'?`<div style="margin-top:8px">分段长度：<input type="number" value="${wz.segLen}" style="width:100px" onchange="wz.segLen=+this.value||500"> 字符</div>`:''}</div>
  <div class="wz-opt ${wz.segMode==='hier'?'on':''}" onclick="wz.segMode='hier';renderWz()"><b>按层级分段</b><p>按照文档层级结构分段（#标题 / 第X章 / 1.2 编号），将文档转化为有层级信息的树结构</p></div>`;
}
function wzSplit(f){
  let txt=f.text;
  if(!txt)return ['（二进制文件：本地原型暂不解析正文。接入在线解析服务后，此处将展示抽取出的分段内容）'];
  txt=txt.replace(/\r/g,'');
  if(wz.filterTxt){try{txt=txt.replace(new RegExp(wz.filterTxt,'g'),'')}catch(e){toast('过滤正则有误，已忽略')}}
  const len=Math.max(100,+wz.segLen||500);
  let parts;
  if(wz.segMode==='hier')parts=txt.split(/(?=^(?:#{1,4}\s|第[一二三四五六七八九十百0-9]+[章节部分篇]|[0-9]+(?:\.[0-9]+)*\s))/m);
  else if(wz.segMode==='custom'){parts=[];for(let i=0;i<txt.length;i+=len)parts.push(txt.slice(i,i+len))}
  else parts=txt.split(/\n{2,}|(?<=[。；])\n/);
  let out=[];
  parts.filter(p=>p&&p.trim()).forEach(p=>{
    if(wz.segMode!=='custom'&&p.length>len*1.4){for(let i=0;i<p.length;i+=len)out.push(p.slice(i,i+len).trim())}
    else out.push(p.trim())});
  return out.filter(Boolean).slice(0,500);
}
function wzS3(){
  if(wz.cur>=wz.files.length)wz.cur=0;
  const f=wz.files[wz.cur];
  const segs=f?wzSplit(f):[];
  return `<div class="wz3">
    <div><h4>文档列表</h4>${wz.files.map((x,i)=>`<div class="pnode ${i===wz.cur?'on':''}" onclick="wz.cur=${i};renderWz()">${esc(x.name)}</div>`).join('')}</div>
    <div><h4>原始文档预览</h4><div style="font-size:12.5px;line-height:1.8;white-space:pre-wrap">${esc(f?(f.text?f.text.slice(0,3000)+(f.text.length>3000?'\n…（截断预览）':''):'（未提取到文本内容）'):'—')}</div></div>
    <div><h4>分段预览 · ${segs.length} 段（${{auto:'自动分段与清洗',custom:'自定义长度',hier:'按层级分段'}[wz.segMode]}）</h4>
      ${segs.slice(0,60).map((s,i)=>`<div class="seg-card"><b>分段 ${i+1} · ${s.length} 字</b><br>${esc(s.slice(0,160))}${s.length>160?'…':''}</div>`).join('')||'<div class="empty">无分段</div>'}${segs.length>60?'<div class="empty">仅预览前 60 段</div>':''}</div>
  </div>`;
}
function wzS4(){
  return `<div style="font-weight:700;margin-bottom:10px">服务器处理中 <small style="color:var(--sub);font-weight:400">（本地模拟：真实环境为 文档解析 → 分段清洗 → embedding 向量化 → 写入索引）</small></div>
  ${wz.files.map(f=>`<div class="kb-item" style="padding:12px"><div style="display:flex;align-items:center;gap:10px"><span>📄</span><b style="flex:1">${esc(f.name)}</b><span>${Math.round(f.p||0)}%</span></div>
    <div class="pbar"><i style="width:${f.p||0}%"></i></div></div>`).join('')}
  ${wz.allDone?'<div class="hint" style="margin-top:12px;background:#e6f4ea;color:var(--ok)">✔ 全部处理完成，点击「确认入库」写入向量知识库（分段数据将用于召回调试）</div>':''}`;
}
function wzStartProc(){
  if(wz._proc)return;wz._proc=1;wz.files.forEach(f=>f.p=0);
  wzTimer=setInterval(()=>{
    let done=true;
    wz.files.forEach(f=>{f.p=Math.min(100,(f.p||0)+9+Math.random()*17);if(f.p<100)done=false});
    if(done&&!wz.allDone){wz.allDone=true}
    renderWz();
  },280);
}
function wzPrev(){if(wz.step>1){wz.step--;renderWz()}}
function wzNext(){
  if(wz.step===1&&!wz.files.length){toast('请先上传至少一个文件');return}
  if(wz.step<4){wz.step++;if(wz.step===4)wzStartProc();renderWz();return}
  if(!wz.allDone)return;
  wzFinish();
}
function wzFinish(){
  clearInterval(wzTimer);
  const target=defaultCat();
  wz.files.forEach(f=>{
    const segs=wzSplit(f);
    store.kb.unshift({id:uid(),title:f.name.replace(/\.[^.]+$/,''),catId:target,tags:['已向量化',f.ext.toUpperCase()],
      content:(f.text||'（二进制文件，待在线解析提取正文）').slice(0,20000),segs:segs.map(s=>s.slice(0,500)),
      date:today(),file:f.name,parse:wz.parse,segMode:wz.segMode});
  });
  const n=wz.files.length;
  wz=null;persist();closeMask('mWizard');renderKb();
  toast(`${n} 个文件已向量化入库 ✔ 可点「🔍 召回调试」验证效果`);
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
        <button class="btn sm ghost" onclick="pdMove('${dc.id}')">移动</button>
        <button class="btn sm danger" onclick="pdDel('${dc.id}')">删除</button></td></tr>`).join('')+'</table></div>';
}
function pdFind(id){
  for(const pid in store.pdocs){const d=store.pdocs[pid];
    for(const tab of['input','output','ref']){const i=d[tab].findIndex(x=>x.id===id);if(i>-1)return{list:d[tab],i,tab,pid}}
    let ri=d.process.docs.findIndex(x=>x.id===id);if(ri>-1)return{list:d.process.docs,i:ri,tab:'process',pid};
    for(const f of d.process.folders){const fi=f.docs.findIndex(x=>x.id===id);if(fi>-1)return{list:f.docs,i:fi,tab:'process',pid}}}
  return null;
}
function pdTargetList(d){return pdTab==='process'?(pdFolder==='root'?d.process.docs:((d.process.folders.find(f=>f.id===pdFolder)||d.process).docs)):d[pdTab]}
function pdUpload(inp){
  if(!pdPid)return;const d=pdOf(pdPid);const target=pdTargetList(d);
  [...inp.files].forEach(f=>{
    const ext=f.name.split('.').pop().toLowerCase();
    const dc={id:uid(),name:f.name,kind:ext.toUpperCase(),size:f.size,date:today(),from:'上传',note:'',content:''};
    target.push(dc);
    if(['txt','md','csv','json','log'].includes(ext)){const r=new FileReader();r.onload=()=>{dc.content=r.result.slice(0,50000);persist();renderPdocs()};r.readAsText(f,'utf-8')}});
  persist();renderPdocs();inp.value='';toast('已上传归档到当前分类');
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
function pdDel(id){const r=pdFind(id);if(!r)return;if(!confirm('删除该文档记录？'))return;r.list.splice(r.i,1);persist();renderPdocs()}
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
  q+=`【项目概况】\n项目名称：${p.name}\n客户：${p.customer}\n预算：${p.budget||'—'} 万元 · 阶段：${p.stage} · C139赢单率：${s.rate}%（${s.zone==='win'?'赢单区':s.zone==='mid'?'抖动区':'输单区'}）\n\n`;
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
  const active=ps.filter(p=>!['已中标','已流标','已输标'].includes(p.stage));
  const win=ps.filter(p=>p.stage==='已中标').length;
  const totalBudget=ps.reduce((s,p)=>s+(parseFloat(p.budget)||0),0);
  const avgRate=active.length?Math.round(active.reduce((s,p)=>s+c139Stats(p.c139).rate,0)/active.length):0;
  document.getElementById('dashKpis').innerHTML=[
    ['在途项目',active.length,'个'],['累计跟踪项目',ps.length,'个'],['预算总额',totalBudget,'万'],['已中标',win,'个'],['平均赢单率',avgRate,'%']
  ].map(k=>`<div class="kpi"><div class="lb">${k[0]}</div><div class="num">${k[1]}<small style="font-size:12px;font-weight:400"> ${k[2]}</small></div><div class="lb">&nbsp;</div></div>`).join('');
  const stages=['前期交流','方案阶段','招投标阶段','已中标','已流标','已输标'];
  const max=Math.max(1,...stages.map(s=>ps.filter(p=>p.stage===s).length));
  document.getElementById('dashFunnel').innerHTML=stages.map(s=>{
    const n=ps.filter(p=>p.stage===s).length;
    return `<div class="funnel-row"><div class="fname">${s}</div><div class="fbar"><i style="width:${Math.round(n/max*100)}%">${n}</i></div></div>`}).join('')||'<div class="empty">暂无数据</div>';
  const top=[...active].sort((a,b)=>c139Stats(b.c139).rate-c139Stats(a.c139).rate).slice(0,6);
  document.getElementById('dashTop').innerHTML=top.length?'<table>'+top.map(p=>{const s=c139Stats(p.c139);return `<tr><td><b style="cursor:pointer;color:var(--brand)" onclick="openDetail('${p.id}')">${esc(p.name)}</b><br><small style="color:var(--sub)">${esc(p.customer)}</small></td>
    <td style="text-align:right"><span class="pct" style="font-weight:700;color:${s.rate>=85?'var(--ok)':s.rate>=50?'#b25e0c':'var(--bad)'}">${s.rate}%</span> ${zoneBadge(s.zone)}</td></tr>`}).join('')+'</table>'
    :'<div class="empty">暂无在途项目</div>';
  const events=[];ps.forEach(p=>(p.timeline||[]).slice(0,3).forEach(t=>events.push({...t,pname:p.name,id:p.id})));
  events.sort((a,b)=>b.d.localeCompare(a.d));
  document.getElementById('dashRecent').innerHTML=events.slice(0,8).map(e=>`<div class="tl-item"><div class="d">${esc(e.d)}</div><div class="t"><b style="cursor:pointer;color:var(--brand)" onclick="openDetail('${e.id}')">${esc(e.pname)}</b> · ${esc(e.t)}</div></div>`).join('')||'<div class="empty">暂无动态</div>';
}

/* ================= 数据备份 ================= */
function exportAll(){download('售前工作台数据备份-'+today()+'.json',JSON.stringify(store,null,2),'application/json');toast('已导出备份文件')}
function importAll(inp){const f=inp.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{store=JSON.parse(r.result);persist();show('dash');toast('导入成功')}catch(e){toast('文件格式错误')}};r.readAsText(f);inp.value=''}

/* ================= 演示种子数据 ================= */
function seed(){
  if(store.projects.length||store.kb.length){return}
  const c=defaultC139();c.is1W=false;c.coach=true;c.consensus=[true,true,false];c.factors=[true,true,true,true,true,true,true,false,false];c.note='信息中心王主任，希望我方赢单，多次核实友商动态';
  store.projects=[{id:'demo1',name:'某市政务云二期建设项目',customer:'某市大数据管理局',stage:'方案阶段',budget:'860',owner:'张三',keyDate:'2026-10-15',
    source:'通过行业展会获知，客户一期由友商承建，二期预算已列入财政计划',created:today(),c139:c,
    bg:{why:'一期资源利用率低、跨部门数据共享难，领导要求二期实现统一算力与数据中枢',chain:'分管副局长（决策者）；大数据局局长（使用方代表）；信息中心王主任（技术把关，倾向我方）',rival:'A公司（一期承建商，有粘性）；B公司（低价策略）'},
    tasks:[{title:'完成首次交流PPT并预约副局长汇报',done:true},{title:'补齐9要素第8、9项研判',done:false},{title:'输出技术方案PPT初稿',done:false}],
    timeline:[{d:today(),t:'创建项目并导入C139评估'},{d:today(),t:'完成信息中心王主任拜访'}],docs:[]}];
  store.tasks=[{id:'t1',projectId:'demo1',type:'first',title:'某市政务云二期建设整体思路交流',autoTitle:true,status:'chat',qIndex:1,created:today(),ts:Date.now()-22e5,draft:null,
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
  store.pdocs={demo1:{input:[{id:uid(),name:'政务云二期需求建议书（客户邮件附件）',kind:'PDF',size:0,date:today(),from:'登记',note:'客户信息中心发送 v1.2',content:''}],process:{folders:[{id:'f1',name:'调研记录',docs:[{id:uid(),name:'信息中心王主任访谈纪要',kind:'MD',size:0,date:today(),from:'上传',note:'2026-08 现场调研',content:'要点：一期利用率不足35%；二期考核指标为跨部门共享率；副局长关注自主可控。'}]}],docs:[]},output:[],ref:[{id:uid(),name:'GB/T 政务云安全要求',kind:'PDF',size:0,date:today(),from:'登记',note:'标准规范参考',content:''}]}};
  persist();
}

/* ================= 启动 ================= */
load();seed();renderDash();renderProjects();
