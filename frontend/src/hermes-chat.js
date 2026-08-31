/* =========================================================================
 * 方案制作中心 · 接入 Hermes Agent（profile: wordpresales）
 * -------------------------------------------------------------------------
 * 本文件在 main.js 之后加载，覆盖原「本地模拟专家」的对话逻辑，
 * 改为通过同源 BFF（/api/chat, SSE 流式）与真实 Hermes 智能体对话。
 * 设计要点：
 *   - 每个前端任务对应一个 Hermes session，任务即历史对话。
 *   - 新建任务为「纯新对话」，不再自动注入项目背景。
 *   - 第一次用户发送或点击「生成完整初稿」时才创建 Hermes session。
 *   - 任务对象保存 hxSessionId（短码）与 hxStoredSessionId（长码），刷新/重启可恢复。
 *   - 其余模块（项目管理 / 知识库 / C139 / 工具箱）逻辑完全不变。
 * ========================================================================= */
(function () {
  'use strict'

  var API = (window.HX_API_BASE || '').replace(/\/$/, '')

  /* 运行态放在内存里，绝不写进 localStorage（否则刷新后会残留"回复中"把输入框锁死） */
  var HX_BUSY = {}, HX_CTRL = {}
  /* 当前任务的文件附件：key=taskId, value=[{name,text,chars,ext}] */
  var HX_ATTACH = {}
  function hxBusy(id) { return !!HX_BUSY[id] }
  window.hxBusy = hxBusy

  /* 清理上一次会话可能残留的流式状态 */
  function hxSanitize() {
    ;(store.tasks || []).forEach(function (t) {
      if (t.hxBusy) delete t.hxBusy
      if (t._ctrl) delete t._ctrl
      if (t.msgs && t.msgs.length) {
        t.msgs.forEach(function (m) {
          if (m.streaming) { delete m.streaming; if (!m.text) m.text = '（上次回复未完成，已中断）' }
        })
      }
    })
    persist()
  }
  hxSanitize()

  /* ---------------- 样式（注入，不改 styles.css） ---------------- */
  var css = ''
    + '.hx-badge{display:inline-block;margin-left:10px;padding:2px 9px;border-radius:20px;font-size:11.5px;font-weight:700;vertical-align:middle;background:#eef1f6;color:#6b7280}'
    + '.hx-badge.ok{background:rgba(34,160,90,.12);color:#1a8a4e}'
    + '.hx-badge.bad{background:rgba(239,83,80,.12);color:#d33}'
    + '.hx-status{margin-top:6px;font-size:12px;color:var(--sub);font-style:italic}'
    + '.hx-caret{display:inline-block;width:7px;background:currentColor;opacity:.55;animation:hxb 1s steps(1) infinite;margin-left:1px}'
    + '@keyframes hxb{50%{opacity:0}}'
    + '.hx-live{white-space:pre-wrap;word-break:break-word}'
    + '.hx-err{color:#d33;font-size:12.5px;margin-top:6px}'
    + '.chip.hx-stop{background:rgba(239,83,80,.1);border-color:rgba(239,83,80,.35);color:#d33}'
    + '.chip.hx-gen{background:rgba(34,160,90,.1);border-color:rgba(34,160,90,.35);color:#1a8a4e;font-weight:700}'
    + '.hx-empty{text-align:center;color:var(--sub);padding:30px 10px;font-size:13px;line-height:1.7}'
    + '.hx-link{color:var(--brand);cursor:pointer;text-decoration:underline}'
    + '.hx-sess-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);cursor:pointer;transition:.1s}'
    + '.hx-sess-row:hover{background:#f8f9fb}'
    + '.hx-sess-row .tt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.hx-sess-row .sub{font-size:11.5px;color:var(--sub)}'
    + '.hx-sess-row .tag{font-size:11px;padding:1px 6px;border-radius:4px;background:#eef1f6}'
    + '.hx-attach{display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:6px;background:#f2f7ff;border:1px solid #d6e4ff;font-size:12px;color:#2563eb;max-width:260px;cursor:default;margin:4px 0}'
    + '.hx-attach .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.hx-attach .x{cursor:pointer;padding:2px 4px;border-radius:4px}'
    + '.hx-attach .x:hover{background:#e0ecff}'
    + '.hx-attach .meta{font-size:10px;color:var(--sub)}'
    + '.hx-attach-row{display:flex;flex-wrap:wrap;gap:6px;padding:6px 10px}'
    + '.hx-attach-err{color:var(--bad);font-size:11px;padding:4px 10px}'
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st)

  /* ---------------- 健康检查徽标 ---------------- */
  function hxBadge(cls, txt, title) {
    var el = document.getElementById('hxBadge')
    if (!el) return
    el.className = 'hx-badge ' + (cls || '')
    el.textContent = txt
    if (title) el.title = title
  }
  function hxHealth() {
    fetch(API + '/api/health').then(function (r) { return r.json() }).then(function (d) {
      var ok = d && (d.hermesReachable === 200 || typeof d.hermesReachable === 'number')
      hxBadge(ok ? 'ok' : 'bad',
        ok ? '● Hermes 已连接 · ' + (d.profile || '') : '● Hermes 不可达',
        'BFF 内存 ' + (d.memoryMB || '?') + 'MB · 会话 ' + ((d.pool || {}).sessions || 0) + '/' + ((d.pool || {}).max || 0) + ' · ' + (d.hermesUrl || ''))
    }).catch(function () { hxBadge('bad', '● 后端未连接', '无法访问 /api/health，前端可能以静态方式打开') })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hxHealth)
  else hxHealth()
  setInterval(hxHealth, 60000)

  /* ---------------- Markdown → HTML（用于初稿进编辑器） ---------------- */
  function inl(s) {
    s = esc(s)
    s = s.replace(/`([^`]+)`/g, '<code style="background:#f2f4f8;padding:1px 4px;border-radius:4px">$1</code>')
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    return s
  }
  function hxMd2Html(md) {
    var lines = String(md || '').replace(/\r/g, '').split('\n')
    var out = [], i = 0, inCode = false, code = []
    function flushList(tag, items) { out.push('<' + tag + '>' + items.map(function (x) { return '<li>' + inl(x) + '</li>' }).join('') + '</' + tag + '>') }
    while (i < lines.length) {
      var L = lines[i]
      if (/^\s*```/.test(L)) {
        if (inCode) { out.push('<pre style="background:#f6f8fa;padding:10px 12px;border-radius:8px;overflow:auto">' + esc(code.join('\n')) + '</pre>'); code = []; inCode = false }
        else inCode = true
        i++; continue
      }
      if (inCode) { code.push(L); i++; continue }
      if (/^\s*$/.test(L)) { i++; continue }
      var h = /^(#{1,6})\s+(.*)$/.exec(L)
      if (h) { var n = Math.min(h[1].length + 1, 6); out.push('<h' + n + '>' + inl(h[2]) + '</h' + n + '>'); i++; continue }
      if (/^\s*([-*_])\s*\1\s*\1[\s-*_]*$/.test(L)) { out.push('<hr>'); i++; continue }
      if (/^\s*\|.*\|\s*$/.test(L)) {
        var rows = []
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++ }
        var cells = rows.map(function (r) { return r.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim() }) })
        var body = cells.filter(function (r) { return !r.every(function (c) { return /^:?-{2,}:?$/.test(c) }) })
        var html = '<table style="width:100%;border-collapse:collapse;margin:8px 0">'
        body.forEach(function (r, ri) {
          html += '<tr>' + r.map(function (c) {
            return ri === 0
              ? '<th style="border:1px solid #dfe3ea;padding:6px 8px;background:#f5f7fa;text-align:left">' + inl(c) + '</th>'
              : '<td style="border:1px solid #dfe3ea;padding:6px 8px">' + inl(c) + '</td>'
          }).join('') + '</tr>'
        })
        out.push(html + '</table>'); continue
      }
      if (/^\s*>\s?/.test(L)) {
        var q = []
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++ }
        out.push('<blockquote style="border-left:3px solid var(--brand);padding-left:12px;color:var(--sub);margin:8px 0">' + inl(q.join(' ')) + '</blockquote>')
        continue
      }
      if (/^\s*[-*+]\s+/.test(L)) {
        var ul = []
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { ul.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++ }
        flushList('ul', ul); continue
      }
      if (/^\s*\d+[.)]\s+/.test(L)) {
        var ol = []
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { ol.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++ }
        flushList('ol', ol); continue
      }
      var para = []
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|\s*\||\s*>|\s*```)/.test(lines[i])) { para.push(lines[i]); i++ }
      out.push('<p>' + inl(para.join('\n')) + '</p>')
    }
    if (inCode && code.length) out.push('<pre>' + esc(code.join('\n')) + '</pre>')
    return out.join('\n')
  }
  window.hxMd2Html = hxMd2Html

  /* ---------------- 提示词构造 ---------------- */
  var OUT_REQ = {
    bidword: '- 七章结构：项目理解与需求分析 / 总体设计 / 详细技术方案 / 实施方案 / 售后服务 / 公司实力与案例 / 附件索引\n'
      + '- 条目/段落式表述，不使用表格；所有★号条款逐条正偏离响应\n'
      + '- 数字与口径前后必须一致；无法确定处标注【待确认】\n'
      + '- 篇幅充分，正文不少于 3000 字',
    first: '- 逐页输出：页码、标题、3-5 条要点、讲稿提示\n- 封面含项目名与客户名；控制在 10-14 页\n- 用客户的业务语言讲价值，不堆技术名词',
    tech: '- 逐页输出：页码、标题、3-5 条要点、讲稿提示\n- 覆盖需求理解 / 总体架构 / 关键技术设计 / 部署与安全 / 实施计划\n- 控制在 10-14 页',
    bidppt: '- 逐页输出：页码、标题、3-5 条要点、讲稿提示\n- 控制在 8-10 页，末尾附「评委问答口径卡」\n- 亮点必须对应评分办法',
    other: '- 直接产出期望交付物（纪要 / 对比表 / 清单 / 文档草稿）\n- 明确责任人与时间；无法确定处标注【待确认】',
  }

  function hxProjectBlock(p) {
    var s = (typeof c139Stats === 'function' && p.c139) ? c139Stats(p.c139) : { rate: '—', zone: '' }
    var q = '【项目概况】\n'
      + '项目名称：' + (p.name || '—') + '\n'
      + '客户：' + (p.customer || '—') + '\n'
      + '预算：' + (p.budget || '—') + ' 万元 ｜ 阶段：' + (p.stage || '—')
      + ' ｜ C139 赢单率：' + s.rate + '%'
      + (s.zone ? '（' + (s.zone === 'win' ? '赢单区' : s.zone === 'mid' ? '抖动区' : '输单区') + '）' : '') + '\n'
      + (p.source ? '项目来源：' + p.source + '\n' : '')
    q += '\n【项目背景收集表】\n'
    var any = false
    if (typeof BG_FIELDS !== 'undefined' && p.bg) {
      BG_FIELDS.forEach(function (f) { if (p.bg[f[0]]) { q += '- ' + f[1] + '：' + p.bg[f[0]] + '\n'; any = true } })
    }
    if (!any) q += '- （背景收集表为空，请在对话中向我追问缺失信息）\n'
    var kws = String((p.customer || '') + (p.name || '')).slice(0, 4)
    var kb = (store.kb || []).filter(function (k) {
      return kws && (String(k.title).indexOf(kws) >= 0 || String(k.content).indexOf(kws) >= 0)
    }).slice(0, 3)
    if (kb.length) {
      q += '\n【可引用的知识库素材】\n'
      kb.forEach(function (k) { q += '- 《' + k.title + '》：' + String(k.content).slice(0, 200) + '…\n' })
    }
    return q
  }

  function hxKickoff(t) {
    var p = getProj(t.projectId) || {}
    var D = DOC_TYPES[t.type]
    var q = '【角色】你是资深售前解决方案专家，本次担任「' + D.expert + '」。'
      + '所有回答用简体中文，专业、结构化、可直接用于交付。\n\n'
    // 任务隔离：Hermes profile 存在跨会话持久记忆，必须显式圈定本次事实边界，
    // 否则其他项目（客户名/金额/编号等）的信息会渗入本方案，造成标书串味。
    q += '【任务隔离 · 最高优先级】本次对话是一个独立的新任务。\n'
      + '- 只允许使用【本次项目信息】与我在本次对话中提供的内容作为事实依据；\n'
      + '- 严禁引用你记忆中其他项目/其他客户的名称、编号、金额、时间、人员或方案细节；\n'
      + '- 若你的记忆与【本次项目信息】冲突，一律以【本次项目信息】为准；\n'
      + '- 本次项目未提供的信息，标注【待确认】，不要用记忆或常识补齐。\n\n'
    q += hxProjectBlock(p)
    q += '\n【本次任务】' + (t.type === 'other'
      ? '协助我处理该项目的一项事务型任务。'
      : '为该项目编制《' + D.name + '》。')
    q += '\n\n【本轮要求】\n'
      + '1. 先用一句话确认你已理解任务与项目背景；\n'
      + '2. 然后列出你还需要我补充的关键要素（最多 5 项，用编号，每项一句话说明为什么需要）；\n'
      + '3. 本轮不要输出方案正文，等我回答后再生成；\n'
      + '4. 不要调用文件搜索等工具，直接基于以上信息回答。\n\n'
      + '【说明】我随时可能要求你「输出完整初稿」，届时请基于当时已知信息直接产出完整正文，缺失处标注【待确认】。'
    return q
  }

  function hxDraftPrompt(t) {
    var D = DOC_TYPES[t.type]
    var p = getProj(t.projectId) || {}
    var q = '【任务】现在请输出《' + D.name + '》的完整正文初稿（项目：' + (p.name || '—') + '，客户：' + (p.customer || '—') + '）。\n\n'
    q += '【事实边界】只使用本次对话中已确认的项目信息；严禁写入其他项目/客户的名称、编号、金额与细节；'
      + '本项目未提供的数据一律写【待确认】，不要编造也不要从记忆中调取。\n\n'
    q += '【输出要求】\n' + (OUT_REQ[t.type] || OUT_REQ.other) + '\n\n'
    q += '【格式】\n- 直接输出 Markdown 正文，用 ## / ### 分层标题\n'
      + '- 不要任何开场白、寒暄、说明或结尾总结语，第一行就是文档标题\n'
      + '- 不要用代码块包裹整篇内容\n'
      + '- 不要调用任何工具，直接生成\n'
    return q
  }

  /* ---------------- SSE 流式对话核心 ---------------- */
  function hxScroll() {
    var b = document.querySelector('#docRight .chat-body')
    if (b) b.scrollTop = b.scrollHeight
  }
  function hxSetStatus(s) {
    var el = document.getElementById('hxStatus')
    if (el) el.textContent = s || ''
  }

  function hxSaveSession(t, ev) {
    if (!t || !ev) return
    if (ev.sessionId && ev.sessionId !== t.hxSessionId) {
      t.hxSessionId = ev.sessionId
      t.hxStoredSessionId = ev.storedSessionId || t.hxStoredSessionId
      t.hx = true
      persist()
    }
  }

  /* ---------------- 文件附件：前端选文件 → BFF 提取文本 ---------------- */
  function hxFileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader()
      r.onload = function () { resolve(r.result.split(',')[1]) }
      r.onerror = function () { reject(new Error('读取文件失败')) }
      r.readAsDataURL(file)
    })
  }

  function hxExtractFile(file) {
    return hxFileToBase64(file).then(function (b64) {
      return fetch(API + '/api/chat/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: file.name, base64: b64 }),
      }).then(function (r) {
        if (!r.ok) {
          return r.json().then(function (d) { throw new Error(d.error || ('提取失败 HTTP ' + r.status)) })
            .catch(function () { throw new Error('提取失败 HTTP ' + r.status) })
        }
        return r.json()
      })
    })
  }

  window.hxAttachFile = function (input) {
    var t = curTaskId ? getTask(curTaskId) : null
    if (!t) { toast('请先创建/打开任务'); input.value = ''; return }
    var files = input.files
    if (!files || !files.length) return
    ;[...files].forEach(function (file) {
      // 占位：避免重复上传同名文件
      var list = HX_ATTACH[t.id] || (HX_ATTACH[t.id] = [])
      if (list.some(function (a) { return a.name === file.name })) { toast('已添加过「' + file.name + '」'); return }
      var placeholder = { name: file.name, text: '', chars: 0, ext: (file.name.split('.').pop() || '').toLowerCase(), loading: true }
      list.push(placeholder)
      renderRightPanel()
      hxExtractFile(file).then(function (d) {
        Object.assign(placeholder, { text: d.text || '', chars: d.chars || 0, ext: d.ext, loading: false, error: null })
        toast('已提取「' + file.name + '」(' + (d.chars || 0) + ' 字符)')
        renderRightPanel()
      }).catch(function (e) {
        placeholder.loading = false
        placeholder.error = String(e && e.message || e)
        toast('附件失败：' + placeholder.error)
        renderRightPanel()
      })
    })
    input.value = ''
  }

  window.hxRemoveAttach = function (taskId, name) {
    var list = HX_ATTACH[taskId]
    if (!list) return
    HX_ATTACH[taskId] = list.filter(function (a) { return a.name !== name })
    renderRightPanel()
  }

  function hxActiveAttachments(taskId) {
    var list = HX_ATTACH[taskId] || []
    return list.filter(function (a) { return a.text && a.text.trim() && !a.loading && !a.error })
  }

  function hxRenderAttachments(taskId) {
    var list = HX_ATTACH[taskId] || []
    if (!list.length) return ''
    var html = '<div class="hx-attach-row">'
    list.forEach(function (a) {
      if (a.loading) {
        html += '<div class="hx-attach"><span>⏳</span><span class="name">' + esc(a.name) + '</span><span class="meta">提取中…</span></div>'
      } else if (a.error) {
        html += '<div class="hx-attach" style="background:#fff2f0;border-color:#ffd0d0;color:#c33"><span>⚠</span><span class="name">' + esc(a.name) + '</span><span class="x" onclick="hxRemoveAttach(\'' + esc(taskId) + '\',\'' + esc(a.name) + '\')">✕</span></div>'
      } else {
        html += '<div class="hx-attach"><span>📄</span><span class="name" title="' + esc(a.name) + '">' + esc(a.name) + '</span><span class="meta">' + (a.chars || 0) + ' 字符</span><span class="x" onclick="hxRemoveAttach(\'' + esc(taskId) + '\',\'' + esc(a.name) + '\')">✕</span></div>'
      }
    })
    html += '</div>'
    var errs = list.filter(function (a) { return a.error })
    if (errs.length) html += '<div class="hx-attach-err">' + esc(errs[0].error) + '</div>'
    return html
  }

  function hxSend(t, text, opts) {
    opts = opts || {}
    if (!t) return Promise.resolve()
    if (hxBusy(t.id)) { toast('专家正在回复中，请稍候'); return Promise.resolve() }
    HX_BUSY[t.id] = true

    if (!opts.hidden) say(t, 'me', text)
    if (!opts.hidden && !t.autoTitle) {
      t.title = String(text).replace(/\s+/g, ' ').slice(0, 24); t.autoTitle = true
    }
    var aiMsg = { role: 'ai', text: '', ts: Date.now(), streaming: true }
    t.msgs.push(aiMsg)
    persist()
    renderRightPanel(); renderTaskList(); renderTypeCards(); hxScroll()
    hxSetStatus(opts.statusText || '正在连接专家智能体…')

    var ctrl = new AbortController()
    HX_CTRL[t.id] = ctrl
    var acc = ''

    // provider 慢/过载时的友好提示：首条消息后若 22s 仍无正文，给出明确反馈，避免"卡死"错觉
    var slowTimer = setTimeout(function () {
      if (!acc) hxSetStatus('模型响应较慢：provider 可能繁忙或过载，请稍候，系统会在恢复后继续…')
    }, 22000)

    function paint() {
      var live = document.getElementById('hxLive')
      if (live) { live.textContent = acc; hxScroll() }
    }

    function finish(finalText, errMsg) {
      clearTimeout(slowTimer)
      aiMsg.text = finalText || acc || ''
      delete aiMsg.streaming
      delete HX_CTRL[t.id]
      delete HX_BUSY[t.id]
      if (errMsg) aiMsg.error = errMsg
      persist()
      renderRightPanel(); renderTaskList(); hxScroll()
      if (opts.onDone) { try { opts.onDone(aiMsg.text) } catch (e) { console.error(e) } }
    }

    var attachList = hxActiveAttachments(t.id)
    var payload = { key: t.id, text: text, reset: !!opts.reset, sessionId: t.hxSessionId || null }
    if (attachList.length) {
      payload.attachments = attachList.map(function (a) { return { name: a.name, text: a.text } })
      // 发送后清空已使用的附件，避免重复注入
      HX_ATTACH[t.id] = []
    }
    return fetch(API + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    }).then(function (r) {
      if (!r.ok || !r.body) throw new Error('后端返回 HTTP ' + r.status)
      var reader = r.body.getReader()
      var dec = new TextDecoder('utf-8')
      var buf = ''
      var finalText = null, errText = null

      function pump() {
        return reader.read().then(function (res) {
          if (res.done) { finish(finalText, errText); return }
          buf += dec.decode(res.value, { stream: true })
          var parts = buf.split('\n\n')
          buf = parts.pop() || ''
          parts.forEach(function (block) {
            block.split('\n').forEach(function (line) {
              if (line.indexOf('data:') !== 0) return
              var payload = line.slice(5).trim()
              if (!payload) return
              var ev
              try { ev = JSON.parse(payload) } catch (e) { return }
              if (ev.type === 'delta') { acc += ev.text || ''; aiMsg.text = acc; clearTimeout(slowTimer); hxSetStatus(''); paint() }
              else if (ev.type === 'status') hxSetStatus(ev.text || '')
              else if (ev.type === 'session') {
                hxSaveSession(t, ev)
                hxSetStatus('已连接（模型 ' + (ev.model || '—') + '），专家正在阅读项目资料…')
              }
              else if (ev.type === 'done') {
                finalText = ev.text || acc
                hxSaveSession(t, ev)
                hxSetStatus('')
              }
              else if (ev.type === 'error') { errText = ev.message || '未知错误'; hxSetStatus('') }
            })
          })
          return pump()
        })
      }
      return pump()
    }).catch(function (e) {
      if (e && e.name === 'AbortError') { finish(acc + '\n\n（已手动中断）'); return }
      var m = String(e && e.message || e)
      finish(acc || '', m)
      toast('对话失败：' + m)
    })
  }
  window.hxSend = hxSend

  function hxStop(id) {
    if (HX_CTRL[id]) { HX_CTRL[id].abort(); toast('已中断本次回复') }
  }
  window.hxStop = hxStop

  function hxReset(id) {
    var t = getTask(id)
    if (!t || hxBusy(t.id)) return
    if (!confirm('重开会话会清空本任务与智能体的对话上下文（已生成的初稿保留），确定？')) return
    fetch(API + '/api/reset', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: t.id }),
    }).catch(function () {})
    t.msgs = []
    delete t.hxSessionId
    delete t.hxStoredSessionId
    t.status = t.draft ? 'draft' : 'chat'
    persist()
    var D = DOC_TYPES[t.type]
    say(t, 'ai', '（会话已重置）我是「' + D.expert + '」' + D.emo + '。新对话已开始，可随时输入消息或点击「生成完整初稿」。')
    renderRightPanel(); renderTaskList()
  }
  window.hxReset = hxReset

  /* ---------------- 覆盖：创建任务 ---------------- */
  // 原 main.js 的 createDocTask 会走本地问答流程；我们整体替换为「纯新对话」，不再自动注入背景。
  window.createDocTask = function (type) {
    var pid = document.getElementById('docProj').value
    if (!pid) { toast('请先在①关联项目'); return }
    store.tasks = store.tasks || []
    var p = getProj(pid)
    var D = DOC_TYPES[type]
    var t = {
      id: uid(), projectId: pid, type: type, title: D.name + ' · 新对话',
      status: 'chat', msgs: [], answers: {}, qIndex: 0,
      created: today(), ts: Date.now(), draft: null, hx: true,
    }
    store.tasks.unshift(t)
    if (typeof addTl === 'function') addTl(p, '创建任务：' + t.title)
    persist()
    curTaskId = t.id; curType = type; docMode = 'chat'; docView = 'task'

    say(t, 'ai', '新对话已创建。\n'
      + '项目：' + p.name + ' · 客户：' + p.customer + ' · 阶段：' + p.stage + '\n'
      + '你可以：\n'
      + '1. 直接输入消息开始对话（此时我会创建新的 Hermes 会话并记住本次任务）；\n'
      + '2. 点下方「生成完整初稿」一次性注入项目背景并产出正文；\n'
      + '3. 点「Hermes 历史会话」把已有历史对话关联到本任务。')
    renderTaskList(); renderTypeCards(); renderRightPanel()
    toast('新对话已创建，未自动注入背景')
  }

  /* ---------------- 覆盖：发送消息 ---------------- */
  window.sendChat = function (id) {
    var inp = document.getElementById('chatIn')
    var t = getTask(id)
    if (!inp || !t) return
    var v = inp.value
    if (!String(v).trim() && !hxActiveAttachments(id).length) return
    inp.value = ''
    hxSend(t, String(v).trim())
  }

  /* ---------------- 覆盖：生成初稿 ---------------- */
  window.genDraft = function (t) {
    if (typeof t === 'string') t = getTask(t)
    if (!t) return
    if (hxBusy(t.id)) { toast('专家正在回复中，请稍候'); return }
    hxSend(t, hxDraftPrompt(t), {
      hidden: true,
      statusText: '专家正在撰写完整初稿，通常需要 1-3 分钟…',
      onDone: function (txt) {
        var body = String(txt || '').trim()
        if (!body) { toast('初稿生成失败，请重试或先补充信息'); return }
        t.draft = hxMd2Html(body)
        t.draftMd = body
        t.status = 'draft'
        docMode = 'edit'
        persist()
        renderTaskList(); renderRightPanel()
        toast('初稿已生成，可直接编辑与导出')
      },
    })
  }

  /* ---------------- 历史 Hermes 会话列表 ---------------- */
  function hxSessionLabel(s) {
    var title = s.title || (s.preview || '').slice(0, 40)
    if (!title) title = '未命名会话'
    return title
  }

  function hxFormatTime(iso) {
    if (!iso) return ''
    try {
      var d = new Date(iso)
      return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch (e) { return iso }
  }

  window.hxOpenSessions = function () {
    var el = document.getElementById('hxSessionsPanel')
    if (!el) {
      el = document.createElement('div')
      el.id = 'hxSessionsPanel'
      el.className = 'mask on'
      el.innerHTML = '<div class="modal" style="max-width:720px">'
        + '<div class="m-head"><b>Hermes 历史会话</b><button class="btn sm ghost" onclick="hxCloseSessions()">关闭</button></div>'
        + '<div id="hxSessionsBody" style="max-height:60vh;overflow:auto"></div></div>'
      document.body.appendChild(el)
    } else {
      el.classList.add('on')
    }
    document.getElementById('hxSessionsBody').innerHTML = '<div class="hx-empty">正在加载…</div>'
    fetch(API + '/api/sessions').then(function (r) { return r.json() }).then(function (d) {
      if (!d.ok) throw new Error(d.error || '加载失败')
      var list = d.sessions || []
      var byKey = {}
      ;(store.tasks || []).forEach(function (t) {
        if (t.hxStoredSessionId) byKey[t.hxStoredSessionId] = t
      })
      var html = ''
      if (!list.length) {
        html = '<div class="hx-empty">暂无 Hermes 历史会话</div>'
      } else {
        list.forEach(function (s) {
          var localTask = byKey[s.id]
          var meta = (s.profile || '') + ' · ' + (s.messageCount || 0) + ' 条消息 · ' + hxFormatTime(s.lastActiveAt || s.startedAt)
          var canBind = !!s.shortId
          html += '<div class="hx-sess-row" data-short="' + esc(s.shortId || '') + '" data-long="' + esc(s.id) + '" onclick="hxPickSession(this)">'
            + '<span class="qw-ico">💬</span>'
            + '<div class="tt"><b>' + esc(hxSessionLabel(s)) + '</b><div class="sub">' + esc(meta) + '</div></div>'
            + (localTask ? '<span class="tag" style="background:#e6f4ea;color:var(--ok)">已关联：' + esc((localTask.title || '').slice(0, 12)) + '</span>' : '<span class="tag">' + (canBind ? '未关联 · 可绑定' : '未关联 · 缺短码') + '</span>')
            + '</div>'
        })
      }
      document.getElementById('hxSessionsBody').innerHTML = html
    }).catch(function (e) {
      document.getElementById('hxSessionsBody').innerHTML = '<div class="hx-empty">加载失败：' + esc(String(e && e.message || e)) + '</div>'
    })
  }
  window.hxCloseSessions = function () {
    var el = document.getElementById('hxSessionsPanel')
    if (el) el.classList.remove('on')
  }

  // 选择历史会话：如果已关联本地任务则打开；否则绑定到当前任务（需要 shortId）
  window.hxPickSession = function (el) {
    var longId = el.dataset.long
    var shortId = el.dataset.short
    var t = (store.tasks || []).find(function (x) { return x.hxStoredSessionId === longId })
    if (t) {
      hxCloseSessions()
      openTaskQw(t.id)
      toast('已打开关联任务')
      return
    }
    if (!shortId) {
      toast('该会话缺少短码，无法继续对话。建议新建任务开始新对话。')
      return
    }
    // 未关联：询问是否把当前任务绑定到该会话
    t = curTaskId ? getTask(curTaskId) : null
    if (!t) { toast('请先创建一个任务，再关联历史会话'); return }
    if (!confirm('把当前任务「' + (t.title || DOC_TYPES[t.type].name) + '」关联到该 Hermes 会话？')) return
    fetch(API + '/api/session/attach', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: t.id, shortId: shortId, longId: longId }),
    }).then(function (r) { return r.json() }).then(function (d) {
      if (!d.ok) throw new Error(d.error || '关联失败')
      t.hxSessionId = shortId
      t.hxStoredSessionId = longId
      persist()
      hxCloseSessions()
      renderTaskList(); renderRightPanel()
      toast('已关联 Hermes 会话：' + shortId)
    }).catch(function (e) {
      toast('关联失败：' + (e && e.message || e))
    })
  }

  /* ---------------- 覆盖：对话区渲染（支持流式 + 空状态） ---------------- */
  window.chatBodyHtml = function (t) {
    var D = DOC_TYPES[t.type]
    var h = '<div class="chat-body">'
    if (!t.msgs || !t.msgs.length) {
      h += '<div class="hx-empty">'
        + '🤖 这是一个全新的 Hermes 对话<br>'
        + '直接输入消息，或点击下方「生成完整初稿」开始'
        + '</div>'
    }
    t.msgs.forEach(function (m) {
      if (m.streaming) {
        h += '<div class="msg ai"><div class="m-av">' + D.emo + '</div><div class="bubble">'
          + '<span class="hx-live" id="hxLive"></span><span class="hx-caret">&nbsp;</span>'
          + '<div class="hx-status" id="hxStatus"></div></div></div>'
      } else {
        h += '<div class="msg ' + m.role + '"><div class="m-av">' + (m.role === 'ai' ? D.emo : '🧑') + '</div>'
          + '<div class="bubble">' + esc(m.text)
          + (m.error ? '<div class="hx-err">⚠ ' + esc(m.error) + '</div>' : '')
          + '</div></div>'
      }
    })
    h += '</div>'
    h += '<div class="chips">'
    if (hxBusy(t.id)) {
      h += '<span class="chip hx-stop" onclick="hxStop(\'' + t.id + '\')">⏹ 停止生成</span>'
    } else {
      h += '<span class="chip hx-gen" onclick="genDraft(getTask(\'' + t.id + '\'))">⚡ '
        + (t.draft ? '按最新对话重新生成初稿' : '生成完整初稿') + '</span>'
      h += '<span class="chip" onclick="pickKbForAnswer(\'' + t.id + '\')">📚 @知识库素材</span>'
      h += '<span class="chip" onclick="hxSend(getTask(\'' + t.id + '\'),\'请基于当前信息，补充说明我方相对竞争对手的差异化优势，条目式，不超过 8 条。\')">💡 追问差异化优势</span>'
      h += '<span class="chip" onclick="hxReset(\'' + t.id + '\')">🔄 重开会话</span>'
      h += '<span class="chip" onclick="hxOpenSessions()">📜 Hermes 历史会话</span>'
    }
    h += '</div>'
    return h
  }

  /* ---------------- 覆盖：输入栏 ---------------- */
  window.qwInputBar = function (t) {
    var active = !!t && docMode === 'chat' && !hxBusy(t.id)
    var ph = t
      ? (hxBusy(t.id) ? '专家正在回复中…' : '输入消息，回车发送给 Hermes · wordpresales')
      : '今天帮你做些什么？请先在左侧选择文档类型并发起新对话'
    var attachHtml = t ? hxRenderAttachments(t.id) : ''
    return '<div class="qw-input">'
      + (attachHtml || '')
      + '<input id="chatIn" ' + (active ? '' : 'disabled') + ' placeholder="' + esc(ph) + '" '
      + (active ? 'onkeydown="if(event.key===\'Enter\')sendChat(\'' + t.id + '\')"' : '') + '>'
      + '<div class="qi-bar">'
      + '<span class="qi-ico" title="引用知识库素材" onclick="' + (active ? 'pickKbForAnswer(\'' + t.id + '\')' : 'toast(\'请先创建/打开任务\')') + '">＋</span>'
      + '<span class="qi-ico" title="上传文件让大模型分析（支持 txt/md/json/csv/docx）" onclick="' + (active ? 'document.getElementById(\'chatAttach\').click()' : 'toast(\'请先创建/打开任务\')') + '">📎</span>'
      + '<input type="file" id="chatAttach" style="display:none" onchange="hxAttachFile(this)">'
      + '<div style="flex:1"></div>'
      + '<span class="qi-auto" title="由 Hermes Agent(wordpresales) 真实生成">🤖 Hermes · wordpresales</span>'
      + '<button class="qi-send" title="发送" onclick="' + (active ? 'sendChat(\'' + t.id + '\')' : (t && hxBusy(t.id) ? 'hxStop(\'' + t.id + '\')' : 'toast(\'请先创建/打开任务\')')) + '">➤</button>'
      + '</div></div>'
  }

  /* ---------------- 覆盖：任务列表渲染，增加 Hermes 绑定标识 ---------------- */
  var _renderTaskList = window.renderTaskList
  window.renderTaskList = function () {
    _renderTaskList()
    // 在任务列表底部追加历史会话入口（如果列表容器存在）
    var el = document.getElementById('taskList')
    if (!el) return
    var foot = document.getElementById('hxTaskFoot')
    if (!foot) {
      foot = document.createElement('div')
      foot.id = 'hxTaskFoot'
      foot.style.cssText = 'padding:10px 12px;text-align:center;border-top:1px dashed var(--line);'
      foot.innerHTML = '<span class="hx-link" onclick="hxOpenSessions()">📜 查看 Hermes 历史会话</span>'
      el.parentNode.appendChild(foot)
    }
  }

  /* ---------------- 覆盖：右侧面板，在历史会话弹窗关闭后重新渲染 ---------------- */
  var _rrp = window.renderRightPanel
  window.renderRightPanel = function () {
    _rrp.apply(this, arguments)
    var t = curTaskId ? getTask(curTaskId) : null
    if (!t) return
    var live = document.getElementById('hxLive')
    if (live) {
      var last = t.msgs[t.msgs.length - 1]
      if (last && last.streaming) live.textContent = last.text || live.textContent || ''
    }
  }

  console.log('[hermes-chat] 已接管方案制作中心对话（BFF: ' + (API || '同源') + '/api/chat）')
})()
