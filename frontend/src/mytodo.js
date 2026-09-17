/* ③ 我的待办 · 逾期自动升级
 *  依赖 main.js 全局：store / persist / esc / currentUser / dueState / dueColor / stageBadge / openDetail
 *  依赖 auth.js 全局：window.currentUser()
 */
(function(){
  var _scope='mine';
  function daysFrom(d){ return Math.ceil((new Date(d)-new Date())/86400000) }
  function dueInfo(d){ if(!d) return {txt:''}; var st=dueState(d); var da=daysFrom(d); if(st==='over') return {txt:'逾期'+Math.abs(da)+'天',cls:'over'}; if(da<=3) return {txt:'剩'+Math.max(0,da)+'天',cls:'soon'}; if(da>14) return {txt:''}; return {txt:da+'天后'} }
  window.mytodoScope=function(v){ _scope=v; renderMytodo() }
  window.renderMytodo=function(){
    var el=document.getElementById('mytodoBody'); if(!el) return;
    var me=window.currentUser?currentUser():'';
    var all=[]; (store.projects||[]).forEach(function(p){(p.nextSteps||[]).forEach(function(s){ if(!s.done) all.push({p:p,s:s}) })});
    var rows=all;
    if(_scope==='mine'&&me) rows=all.filter(function(r){ return !r.s.owner||r.s.owner===me });
    rows.sort(function(a,b){ return String(a.s.due||'9999').localeCompare(String(b.s.due||'9999')) });
    var over=rows.filter(function(r){ return dueState(r.s.due)==='over' });
    var soon=rows.filter(function(r){ return r.s.due&&dueState(r.s.due)!=='over'&&daysFrom(r.s.due)<=3 });
    var escList=rows.filter(function(r){ return r.s.due&&dueState(r.s.due)==='over'&&Math.abs(daysFrom(r.s.due))>=3 });
    var m=document.getElementById('scopeMine'),t=document.getElementById('scopeTeam');
    if(m){ m.className='btn'+( _scope==='mine'?'':'-ghost') } if(t){ t.className='btn'+( _scope==='team'?'':'-ghost') }
      var html='<div class="kpis">'+
        '<div class="kpi"><h3>逾期待办</h3><b>'+over.length+'</b><span>已过截止日未完成</span></div>'+
        '<div class="kpi"><h3>3天内到期</h3><b>'+soon.length+'</b><span>逼近截止日</span></div>'+
        '<div class="kpi"><h3>需升级(≥3天)</h3><b style="color:#d6336c">'+escList.length+'</b><span>逾期≥3天，建议升级处理</span></div>'+
        '<div class="kpi"><h3>待办合计</h3><b>'+rows.length+'</b><span>'+( _scope==='mine'?'我名下':'全团队')+'</span></div></div>';
      html+='<div class="card"><h3>待办列表</h3><div style="overflow-x:auto"><table><tr><th>项目</th><th>事项</th><th>责任人</th><th>截止</th><th>状态</th></tr>';
      if(!rows.length) html+='<tr><td colspan="5"><div class="empty">暂无待办'+(_scope==='mine'?'（或未指定责任人）':'')+'</div></td></tr>';
      rows.forEach(function(r){
        var d=dueInfo(r.s.due), is=over.indexOf(r)>=0&&Math.abs(daysFrom(r.s.due))>=3;
        html+='<tr><td><a onclick="openDetail(\''+r.p.id+'\')">'+esc(r.p.name)+'</a> '+stageBadge(r.p.stage)+'</td>'+
          '<td>'+esc(r.s.what||'')+'</td>'+
          '<td>'+esc(r.s.owner||'—')+(r.s.owner&&r.s.owner===me?' <span class="tag">我</span>':'')+'</td>'+
          '<td style="color:'+dueColor(dueState(r.s.due))+'">'+esc(r.s.due||'—')+'</td>'+
          '<td>'+(d.txt?('<span class="badge '+(d.cls==='over'?'b-cancel':(d.cls==='soon'?'b-bid':'b-pre'))+'">'+d.txt+'</span>'):'')+
            (is?' <span class="badge b-cancel">⚠ 升级</span>':'')+'</td></tr>';
      });
      html+='</table></div></div>';
    el.innerHTML=html;
  }
})();