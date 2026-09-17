/* ① 售前人力产能看板
 *  依赖 main.js 全局：store / persist / esc / toast / uid / amountsOf / today / canEdit / currentUser */
(function(){
  var ACTIVE=['前期交流','方案阶段','招投标阶段'];
  function thisWeekMon(){ var d=new Date(); var day=(d.getDay()+6)%7; d.setDate(d.getDate()-day); d.setHours(0,0,0,0); return d.toISOString().slice(0,10) }
  function persons(){ var week=thisWeekMon(), m={};
    (store.projects||[]).forEach(function(p){ var a=[]; if(p.presales)a.push(p.presales); if(p.sales)a.push(p.sales);
      a.forEach(function(n){ if(!n)return; var x=m[n]||(m[n]={name:n,projects:0,active:0,est:0,hours:0}); x.projects++; if(ACTIVE.indexOf(p.stage)>=0){ x.active++; x.est+=(amountsOf(p).est||0) } }) });
    (store.timesheets||[]).forEach(function(t){ if(!t||!t.person)return; var x=m[t.person]||(m[t.person]={name:t.person,projects:0,active:0,est:0,hours:0}); if(t.date&&t.date>=week) x.hours+=Number(t.hours)||0 });
    return Object.keys(m).map(function(k){ return m[k] });
  }
  function loadState(x){ var wk=(x.hours||0)/8, probe=x.active+wk;
    if(x.active>=6||x.hours>=40) return {cls:'over',txt:'超载'};
    if(probe<=1.5) return {cls:'idle',txt:'低负荷'};
    return {cls:'ok',txt:'正常'} }
  function fmtWan(v){ v=Number(v||0); if(!v)return '—'; return v>=10000?(v/10000).toFixed(1)+'亿':v+'万' }
  window.capLog=function(){
    if(!canEdit('projects')){ toast('仅「可编辑」用户可记录工时'); return }
    var person=document.getElementById('capPerson').value, date=document.getElementById('capDate').value||today(),
      hours=parseFloat(document.getElementById('capHours').value), type=document.getElementById('capType').value,
      note=document.getElementById('capNote').value.trim();
    if(!person){ toast('请选择人员'); return } if(!(hours>0)){ toast('请填写时长'); return }
    store.timesheets=store.timesheets||[];
    store.timesheets.push({id:uid(),projectId:'',person:person,date:date,hours:hours,type:type,note:note,createdAt:Date.now(),by:(currentUser?currentUser():'')});
    persist(); renderCapacity(); toast('已记录本工时');
  };
  window.renderCapacity=function(){
    var el=document.getElementById('capBody'); if(!el) return;
    var ps=persons(); ps.sort(function(a,b){ return (b.active+ (b.hours||0)/10) - (a.active+ (a.hours||0)/10) });
    var total=store.projects.length, active=store.projects.filter(function(p){return ACTIVE.indexOf(p.stage)>=0}).length;
    var team=new Set(); (store.projects||[]).forEach(function(p){ if(p.presales)team.add(p.presales) });
    var teamN=team.size;
    var allPersons=ps.map(function(x){return x.name}); if(allPersons.indexOf('—')<0) allPersons.unshift('—');
    var weekHours=ps.reduce(function(a,x){ return a+(x.hours||0) },0);
    var html='<div class="kpis">'+
      '<div class="kpi"><h3>售前人数</h3><b>'+teamN+'</b><span>在管项目担任售前</span></div>'+
      '<div class="kpi"><h3>项目总数</h3><b>'+total+'</b><span>进行中 '+active+'</span></div>'+
      '<div class="kpi"><h3>人均支撑</h3><b>'+(teamN? (total/teamN).toFixed(1):0)+'</b><span>项目/人（售前角色）</span></div>'+
      '<div class="kpi"><h3>本周工时</h3><b>'+weekHours+'h</b><span>已打点（近7天）</span></div></div>';
    html+='<div class="card"><h3>工时打点</h3><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">'+
      '<select id="capPerson" style="min-width:110px">'+allPersons.map(function(n){return '<option>'+esc(n)+'</option>'}).join('')+'</select>'+
      '<input type="date" id="capDate" value="'+today()+'" style="width:150px">'+
      '<input type="number" id="capHours" value="1" min="0.5" step="0.5" style="width:64px" title="时长(小时)">'+
      '<select id="capType"><option>方案</option><option>标书</option><option>POC</option><option>交流</option><option>调研</option><option>支撑</option></select>'+
      '<input id="capNote" placeholder="备注(可选)" style="flex:1;min-width:150px">'+
      '<button class="btn" onclick="capLog()">记一笔</button></div>'+
      '<div class="hint">负荷=进行中项目数(售前+销售)+近7天工时折算，用于识别超载/低负荷；打点仅前台录入，管理层可见。</div></div>';
    html+='<div class="card"><h3>售前产能</h3><div style="overflow-x:auto"><table><tr><th>人员</th><th>角色项目数</th><th>在跟项目</th><th>在跟预估额</th><th>本周工时</th><th>负荷</th></tr>';
    if(!ps.length) html+='<tr><td colspan="6"><div class="empty">暂无数据</div></td></tr>';
    ps.forEach(function(x){ var st=loadState(x);
      html+='<tr><td><b>'+esc(x.name)+'</b></td><td>'+x.projects+'</td><td>'+x.active+'</td><td>'+fmtWan(x.est)+'</td><td>'+(x.hours||0)+'h</td>'+
        '<td><span class="badge '+(st.cls==='over'?'b-cancel':(st.cls==='idle'?'b-pre':'b-win'))+'">'+st.txt+'</span></td></tr>';
    });
    html+='</table></div></div>';
    el.innerHTML=html;
  }
})();