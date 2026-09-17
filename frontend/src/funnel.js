/* ② 商机漏斗数字化
 *  依赖 main.js 全局：store / esc / amountsOf / c139Stats / stageBadge / openDetail / today */
(function(){
  var ACTIVE=['前期交流','方案阶段','招投标阶段'], WON='已中标';
  function rateOf(p){ try{ return c139Stats(p.c139?p.c139:null).rate }catch(e){ return 0 } }
  function dwell(p){ var from=p.stageSince||p.created||today(); var d=Math.floor((new Date()-new Date(from))/86400000); return isNaN(d)||d<0?0:d }
  function fmtWan(v){ v=Number(v||0); if(!v)return '—'; return v>=10000?(v/10000).toFixed(1)+'亿':v+'万' }
  window.renderFunnel=function(){
    var el=document.getElementById('funnelBody'); if(!el) return;
    var rows=ACTIVE.map(function(st){ var psl=store.projects.filter(function(p){return p.stage===st});
      var est=psl.reduce(function(a,p){return a+(amountsOf(p).est||0)},0);
      var fc=psl.reduce(function(a,p){return a+(amountsOf(p).est||0)*rateOf(p)/100},0);
      var dw=psl.reduce(function(a,p){return a+dwell(p)},0);
      return {st:st,count:psl.length,est:est,forecast:fc,dwellAvg:psl.length?Math.round(dw/psl.length):0,ps:psl} });
    var won=store.projects.filter(function(p){return p.stage===WON}); var wonAmt=won.reduce(function(a,p){return a+((amountsOf(p).won)||0)},0);
    var totalForecast=rows.reduce(function(a,r){return a+r.forecast},0); var inFlight=rows.reduce(function(a,r){return a+r.est},0);
    var maxBar=Math.max(1,rows.reduce(function(a,r){return Math.max(a,r.est)},0));
    var html='<div class="kpis">'+
      '<div class="kpi"><h3>全年预测合同额</h3><b>'+fmtWan(totalForecast)+'</b><span>Σ 在途金额×赢单率</span></div>'+
      '<div class="kpi"><h3>在途商机金额</h3><b>'+fmtWan(inFlight)+'</b><span>三个在跟阶段合计</span></div>'+
      '<div class="kpi"><h3>已中标金额</h3><b>'+fmtWan(wonAmt)+'</b><span>'+won.length+' 个已中标项目</span></div>'+
      '<div class="kpi"><h3>漏斗缺口</h3><b>'+fmtWan(Math.max(0,inFlight-wonAmt))+'</b><span>在途−已中标</span></div></div>';
    html+='<div class="card"><h3>各阶段漏斗（金额 / 加权预测 / 停留）</h3><div style="overflow-x:auto"><table><tr><th>阶段</th><th>商机数</th><th>在途金额</th><th>加权预测额</th><th>平均停留</th><th>分布</th></tr>';
    rows.forEach(function(r){ var warn=r.dwellAvg>45?' <span class="badge b-cancel">卡壳&gt;45天</span>':'';
      html+='<tr><td>'+stageBadge(r.st)+warn+'</td><td>'+r.count+'</td><td>'+fmtWan(r.est)+'</td><td>'+fmtWan(r.forecast)+'</td><td>'+r.dwellAvg+'天</td>'+
        '<td><div style="background:rgba(28,94,216,.12);border-radius:4px"><div style="width:'+Math.min(100,Math.round(r.est/maxBar*100))+'%;background:var(--accent,#1c5ed8);height:8px;border-radius:4px"></div></div></td></tr>';
    });
    html+='</table></div><div class="hint">加权预测额 = Σ(在途金额 × C139 赢单率)；停留按「阶段进入时间」统计，历史项目以创建时间近似。</div></div>';
    html+='<div class="grid g2">'+rows.map(function(r){
      return '<div class="card"><h3>'+esc(r.st)+'（'+r.count+'）</h3>'+(r.ps.length?('<div>'+r.ps.slice(0,8).map(function(p){ return '<div style="padding:5px 0;border-bottom:1px solid var(--line,#e6e8ef)"><a onclick="openDetail(\''+p.id+'\')">'+esc(p.name)+'</a> <span class="tag">'+esc(p.customer||'—')+'</span><span style="float:right;color:var(--sub)">'+fmtWan(amountsOf(p).est)+' · 停留'+dwell(p)+'d</span></div>' }).join(''))+'</div>':'<div class="empty">暂无</div>')+'</div>';
    }).join('')+'</div>';
    el.innerHTML=html;
  }
})();