/* ⑤ 客户 360°
 *  依赖 main.js 全局：store / esc / amountsOf / stageBadge / dueState / openDetail */
(function(){
  var ACTIVE=['前期交流','方案阶段','招投标阶段'];
  var _cur=null;
  function escAttr(s){ return String(s).replace(/['"]/g,'') }
  function fmtWan(v){ v=Number(v||0); if(!v)return '—'; return v>=10000?(v/10000).toFixed(1)+'亿':v+'万' }
  function customers(){ var m={};
    (store.projects||[]).forEach(function(p){ var c=(p.customer||'').trim(); if(!c)return;
      var x=m[c]||(m[c]={name:c,projects:[],est:0,won:0,steps:0,followups:0,people:new Set()});
      x.projects.push(p); x.est+=(amountsOf(p).est||0); x.won+=(amountsOf(p).won||0);
      (p.nextSteps||[]).forEach(function(s){ if(!s.done)x.steps++ });
      if(store.followups&&store.followups[p.id]) x.followups+=store.followups[p.id].length;
      (p.people||[]).forEach(function(pp){ if(pp&&pp.name)x.people.add(pp.name) }) });
    var arr=Object.keys(m).map(function(k){ var x=m[k]; x.peopleCount=x.people.size; x.psCount=x.projects.length; return x });
    return arr.sort(function(a,b){ return b.est-a.est });
  }
  function activeCount(c){ return c.projects.filter(function(p){ return ACTIVE.indexOf(p.stage)>=0 }).length }
  function stepOver(p){ var o=(p.nextSteps||[]).filter(function(s){ return !s.done&&s.due&&dueState(s.due)==='over' }).length; return o?'<span class="badge b-cancel">'+o+' 逾期</span>':'—' }
  window.custSel=function(name){ _cur=name; renderCust360() };
  window.renderCust360=function(){
    var el=document.getElementById('csBody'); if(!el) return;
    var cs=customers(); var sel=_cur; if(!cs.some(function(x){return x.name===sel})) sel=cs.length?cs[0].name:null;
    if(cs.length&&_cur===null){ sel=cs[0].name; _cur=sel }
    var html='<div class="grid g2">';
    html+='<div class="card"><h3>客户清单（'+cs.length+'）</h3><div style="max-height:68vh;overflow:auto">';
    if(!cs.length) html+='<div class="empty">暂无客户（项目未填甲方）</div>';
    cs.forEach(function(c){ html+='<div onclick="custSel(\''+escAttr(c.name)+'\')" style="cursor:pointer;padding:9px 4px;border-bottom:1px solid var(--line,#e6e8ef);'+(c.name===sel?'background:rgba(28,94,216,.06)':'')+'"><b>'+esc(c.name)+'</b><div style="font-size:12px;color:var(--sub,#6b7280)">在跟 '+activeCount(c)+' · 金额 '+fmtWan(c.est)+' · 逾期步骤 '+c.steps+'</div></div>' });
    html+='</div></div>';
    var c=cs.find(function(x){ return x.name===sel });
    html+='<div class="card"><h3>'+ (c?esc(c.name):'选择客户') +'</h3>';
    if(c){
      html+='<div class="kpis"><div class="kpi"><h3>在途金额</h3><b>'+fmtWan(c.est)+'</b></div><div class="kpi"><h3>已中标</h3><b>'+fmtWan(c.won)+'</b></div><div class="kpi"><h3>跟进记录</h3><b>'+c.followups+'</b></div><div class="kpi"><h3>决策链人</h3><b>'+c.peopleCount+'</b></div></div>';
      html+='<h4 style="margin:12px 0 6px">在管项目</h4><div style="overflow-x:auto"><table><tr><th>项目</th><th>阶段</th><th>售前</th><th>销售</th><th>预估</th><th>逾期步骤</th></tr>';
      c.projects.forEach(function(p){ html+='<tr><td><a onclick="openDetail(\''+p.id+'\')">'+esc(p.name)+'</a></td><td>'+stageBadge(p.stage)+'</td><td>'+esc(p.presales||'—')+'</td><td>'+esc(p.sales||'—')+'</td><td>'+fmtWan(amountsOf(p).est)+'</td><td>'+stepOver(p)+'</td></tr>' });
      html+='</table></div>';
      html+='<h4 style="margin:12px 0 6px">决策链关键人</h4><div>'+(c.people.size?Array.from(c.people).map(function(n){return '<span class="tag">'+esc(n)+'</span>'}).join(' '):'<span class="sub-cnt">未记录</span>')+'</div>';
    }
    html+='</div></div>';
    el.innerHTML=html;
  }
})();