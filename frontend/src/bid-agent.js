/* =========================================================================
 * 投标智能体 · 独立对话页面 (v2 - UI修复版)
 * ========================================================================= */
(function () {
  'use strict'

  var API = (window.HX_API_BASE || '').replace(/\/$/, '')

  var BA_BUSY = {}, BA_CTRL = {}, BA_POLL = {}, BA_ATTACH = {}
  var baCurConv = null

  /* ====== 样式：对齐主应用设计语言 ====== */
  var css = ''
    /* 布局骨架 */
    + '.ba-wrap{display:flex;gap:14px;height:calc(100vh - 130px);min-height:480px}'
    + '.ba-side{width:260px;flex-shrink:0;background:var(--panel);border-radius:var(--radius);box-shadow:var(--shadow);display:flex;flex-direction:column;overflow:hidden}'
    + '.ba-side-head{padding:14px 14px 10px;border-bottom:1px solid var(--line)}'
    + '.ba-side-head select{width:100%;margin-bottom:8px}'
    + '.ba-side-head .btn{width:100%;justify-content:center}'
    + '.ba-conv-list{flex:1;overflow-y:auto;padding:4px 0}'
    + '.ba-main{flex:1;min-width:0;background:var(--panel);border-radius:var(--radius);box-shadow:var(--shadow);display:flex;flex-direction:column;overflow:hidden}'

    /* 对话列表项 */
    + '.ba-conv{padding:10px 14px;cursor:pointer;border-bottom:1px solid #f0f3f9;transition:background .12s}'
    + '.ba-conv:hover{background:#f7f9fc}'
    + '.ba-conv.on{background:rgba(59,91,219,.06);border-left:3px solid var(--brand);padding-left:11px}'
    + '.ba-conv .tt{font-size:13px;font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.ba-conv .sub{font-size:11px;color:var(--sub);margin-top:3px;display:flex;align-items:center;gap:6px}'
    + '.ba-conv .del{font-size:10px;color:var(--sub);cursor:pointer;padding:1px 6px;border-radius:4px;background:transparent;border:1px solid transparent}'
    + '.ba-conv .del:hover{color:var(--bad);border-color:var(--bad);background:#fde8ef}'
    + '.ba-conv .st{display:inline-block;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:600}'
    + '.ba-conv .st.run{background:rgba(59,91,219,.12);color:var(--brand)}'
    + '.ba-conv .st.done{background:rgba(47,158,68,.12);color:var(--ok)}'
    + '.ba-conv .st.err{background:rgba(214,51,108,.12);color:var(--bad)}'

    /* 对话区 */
    + '.ba-chat{flex:1;overflow-y:auto;padding:18px 22px}'
    + '.ba-chat-empty{text-align:center;color:var(--sub);padding:50px 20px;font-size:14px;line-height:1.9}'
    + '.ba-chat-empty .em{font-size:42px;opacity:.25;margin-bottom:10px}'

    /* 消息气泡 */
    + '.ba-msg{display:flex;gap:10px;margin-bottom:14px}'
    + '.ba-msg .av{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}'
    + '.ba-msg.me .av{background:#e7f0ff;color:#1c5ed8}'
    + '.ba-msg.ai .av{background:rgba(47,158,68,.1);color:var(--ok)}'
    + '.ba-msg .bb{flex:1;min-width:0;border-radius:12px;padding:10px 14px;font-size:14px;line-height:1.7;word-break:break-word}'
    + '.ba-msg.me .bb{background:#e7f0ff}'
    + '.ba-msg.ai .bb{background:#f7f9fc;border:1px solid var(--line)}'
    + '.ba-msg .bb p{margin:4px 0}'
    + '.ba-msg .bb h2,.ba-msg .bb h3{margin:10px 0 4px;font-size:15px}'
    + '.ba-msg .bb table{width:100%;border-collapse:collapse;margin:6px 0}'
    + '.ba-msg .bb th,.ba-msg .bb td{border:1px solid var(--line);padding:4px 8px;font-size:12.5px}'
    + '.ba-msg .bb th{background:#f8fafd}'
    + '.ba-msg .bb pre{background:#eef1f9;padding:8px 12px;border-radius:6px;overflow-x:auto;font-size:12px;margin:6px 0}'
    + '.ba-msg .bb code{background:#eef1f9;padding:1px 4px;border-radius:4px;font-size:12.5px}'
    + '.ba-msg .bb ul,.ba-msg .bb ol{margin:4px 0;padding-left:20px}'
    + '.ba-msg .bb blockquote{border-left:3px solid var(--brand);padding-left:12px;color:var(--sub);margin:6px 0}'

    /* 流式光标 + 状态 */
    + '.ba-caret{display:inline-block;width:6px;height:14px;background:var(--brand);opacity:.5;animation:back 1s steps(1) infinite;margin-left:2px;vertical-align:text-bottom;border-radius:1px}'
    + '@keyframes back{50%{opacity:0}}'
    + '.ba-st{font-size:12px;color:var(--sub);font-style:italic;margin-top:6px}'

    /* 文件下载卡片 */
    + '.ba-fcard{display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:#f7f9fc;margin:8px 0;text-decoration:none;color:inherit;transition:border-color .15s,background .15s}'
    + '.ba-fcard:hover{border-color:var(--brand);background:#eef3fd}'
    + '.ba-fcard .fi{font-size:22px;flex-shrink:0}'
    + '.ba-fcard .fn{font-size:13px;font-weight:600;color:var(--brand);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.ba-fcard .fm{font-size:11px;color:var(--sub);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.ba-fcard .fd{padding:5px 14px;border-radius:8px;background:var(--grad);color:#fff;font-size:12px;font-weight:600;white-space:nowrap;flex-shrink:0}'

    /* 输入栏 */
    + '.ba-input{border-top:1px solid var(--line);padding:12px 16px;background:var(--panel)}'
    + '.ba-input textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 14px;font-size:14px;resize:none;min-height:44px;max-height:120px;font-family:inherit;line-height:1.6;background:#fbfcfe}'
    + '.ba-input textarea:focus{outline:2px solid #c5d3ff;border-color:var(--brand)}'
    + '.ba-tools{display:flex;align-items:center;gap:8px;margin-top:8px}'
    + '.ba-tools .sp{flex:1}'
    + '.ba-chip{padding:5px 13px;border-radius:20px;border:1px solid var(--line);font-size:12px;cursor:pointer;transition:.12s;background:var(--panel);color:var(--ink);white-space:nowrap}'
    + '.ba-chip:hover{background:#eef3fd;border-color:#c5d3ff}'
    + '.ba-chip.gen{border-color:rgba(47,158,68,.3);color:var(--ok);font-weight:600}'
    + '.ba-chip.gen:hover{background:rgba(47,158,68,.06)}'
    + '.ba-chip.stop{border-color:rgba(214,51,108,.3);color:var(--bad)}'
    + '.ba-chip.stop:hover{background:#fde8ef}'
    + '.ba-send{padding:8px 18px;border-radius:9px;border:0;background:var(--grad);color:#fff;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:5px}'
    + '.ba-send:hover{opacity:.9}'
    + '.ba-send:disabled{opacity:.4;cursor:not-allowed}'

    /* 附件 */
    + '.ba-att-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}'
    + '.ba-att{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:6px;background:#eef3fd;border:1px solid #d6e4ff;font-size:12px;color:var(--brand);max-width:240px}'
    + '.ba-att .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.ba-att .xx{cursor:pointer;padding:1px 4px;border-radius:4px;color:var(--sub)}'
    + '.ba-att .xx:hover{color:var(--bad);background:#fde8ef}'
    + '.ba-att .mt{font-size:10px;color:var(--sub)}'
    + '.ba-up-ico{font-size:16px;cursor:pointer;color:var(--sub);padding:4px 6px;border-radius:6px}'
    + '.ba-up-ico:hover{background:#eef3fd;color:var(--brand)}'

  var st = document.createElement('style')
  st.textContent = css
  document.head.appendChild(st)

  /* ====== 数据模型 ====== */
  function baInit() {
    if (!store.bidAgentConvs) store.bidAgentConvs = []
    store.bidAgentConvs.forEach(function (c) {
      delete c._busy
      if (c.msgs) c.msgs.forEach(function (m) {
        if (m.streaming) { delete m.streaming; if (!m.text) m.text = '（上次回复未完成，已中断）' }
      })
    })
    persist()
  }

  function baGetConv(id) { return (store.bidAgentConvs || []).find(function (c) { return c.id === id }) }
  function baConvsForProject(pid) { return (store.bidAgentConvs || []).filter(function (c) { return c.projectId === pid }) }

  function baNewConv(pid) {
    var p = getProj(pid) || {}
    var c = { id: uid(), projectId: pid, title: '新对话 · ' + (p.name || '通用'), msgs: [], hxSessionId: null, hxStoredSessionId: null, createdAt: Date.now(), updatedAt: Date.now(), status: 'chat' }
    store.bidAgentConvs = store.bidAgentConvs || []
    store.bidAgentConvs.unshift(c)
    persist()
    return c
  }

  function baDelConv(id) {
    store.bidAgentConvs = (store.bidAgentConvs || []).filter(function (c) { return c.id !== id })
    if (baCurConv === id) baCurConv = null
    persist()
  }

  function baSaveConv(c) { c.updatedAt = Date.now(); persist() }
  function baBusy(id) { return !!BA_BUSY[id] }

  /* ====== Markdown ====== */
  function baMd(text) { return window.hxMd2Html ? window.hxMd2Html(text) : String(text || '').replace(/</g, '&lt;') }

  /* ====== 文件检测 ====== */
  var WS_PREFIX = '/opt/data/profiles/wordpresales/workspace/'
  function baDetectFiles(text) {
    var files = [], seen = new Set()
    var re = /([^\s"'<>]+\.(?:pptx|ppt|docx|doc|xlsx|xls|pdf))/gi
    var m
    while ((m = re.exec(text)) !== null) {
      var p = m[1]
      if (p.indexOf(WS_PREFIX) >= 0 || p.indexOf('/opt/data/') >= 0) {
        if (!seen.has(p)) { seen.add(p); files.push(p) }
      }
    }
    return files
  }

  function baFileIcon(name) {
    var ext = (name.split('.').pop() || '').toLowerCase()
    if (ext === 'pptx' || ext === 'ppt') return '📊'
    if (ext === 'docx' || ext === 'doc') return '📄'
    if (ext === 'xlsx' || ext === 'xls') return '📋'
    if (ext === 'pdf') return '📕'
    return '📎'
  }

  function baFileName(fp) { var p = fp.split('/'); return p[p.length - 1] || fp }
  function baFileExt(name) { return (name.split('.').pop() || '').toLowerCase() }
  function baDownloadUrl(fp) { return API + '/api/hermes/files/download?path=' + encodeURIComponent(fp) }

  function baFileCardsHtml(text) {
    var files = baDetectFiles(text)
    if (!files.length) return ''
    var html = ''
    files.forEach(function (fp) {
      var name = baFileName(fp)
      html += '<a class="ba-fcard" href="' + baDownloadUrl(fp) + '" download="' + esc(name) + '">'
        + '<span class="fi">' + baFileIcon(name) + '</span>'
        + '<div style="flex:1;min-width:0"><div class="fn">' + esc(name) + '</div>'
        + '<div class="fm">' + esc(fp) + '</div></div>'
        + '<span class="fd">下载</span></a>'
    })
    return '<div style="margin:6px 0">' + html + '</div>'
  }

  /* ====== 文件附件 ====== */
  function baExtractFile(file) {
    return fetch(API + '/api/chat/extract', {
      method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) }, body: file
    }).then(function (r) {
      if (!r.ok) throw new Error('提取失败')
      return r.json()
    })
  }

  window.baAttachFile = function (input) {
    var c = baCurConv ? baGetConv(baCurConv) : null
    if (!c) { toast('请先创建对话'); input.value = ''; return }
    var files = input.files
    if (!files || !files.length) return
    ;[...files].forEach(function (file) {
      var list = BA_ATTACH[c.id] || (BA_ATTACH[c.id] = [])
      var ph = { name: file.name, text: '', chars: 0, loading: true }
      list.push(ph)
      baRenderInput()
      baExtractFile(file).then(function (d) {
        Object.assign(ph, { text: d.text || '', chars: d.chars || 0, loading: false })
        toast('已提取「' + file.name + '」(' + (d.chars || 0) + ' 字)')
        baRenderInput()
      }).catch(function (e) {
        ph.loading = false; ph.error = String(e && e.message || e)
        baRenderInput()
      })
    })
    input.value = ''
  }

  window.baRemoveAttach = function (id, name) {
    var list = BA_ATTACH[id] || []
    BA_ATTACH[id] = list.filter(function (a) { return a.name !== name })
    baRenderInput()
  }

  function baActiveAttachments(id) {
    return (BA_ATTACH[id] || []).filter(function (a) { return a.text && a.text.trim() && !a.loading && !a.error })
  }

  function baRenderAttachments(id) {
    var list = BA_ATTACH[id] || []
    if (!list.length) return ''
    var html = '<div class="ba-att-row">'
    list.forEach(function (a) {
      if (a.loading) html += '<div class="ba-att"><span>⏳</span><span class="nm">' + esc(a.name) + '</span></div>'
      else if (a.error) html += '<div class="ba-att" style="background:#fde8ef;border-color:#ffd0d0;color:var(--bad)"><span>⚠</span><span class="nm">' + esc(a.name) + '</span></div>'
      else html += '<div class="ba-att"><span>📄</span><span class="nm">' + esc(a.name) + '</span><span class="mt">' + (a.chars || 0) + '字</span><span class="xx" onclick="baRemoveAttach(\'' + esc(id) + '\',\'' + esc(a.name) + '\')">✕</span></div>'
    })
    return html + '</div>'
  }

  /* ====== 轮询 ====== */
  function baPollTask(c, taskId, acc, aiMsg, onDone) {
    var timer = null
    function poll() {
      fetch(API + '/api/chat/poll/' + encodeURIComponent(taskId))
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)) })
        .then(function (d) {
          if (d.status === 'done') {
            if (d.sessionId) { c.hxSessionId = d.sessionId; c.hxStoredSessionId = d.storedSessionId || c.hxStoredSessionId; baSaveConv(c) }
            onDone(d.text || acc || '', null); return
          }
          if (d.status === 'error') { onDone(d.text || acc || '', d.error || '失败'); return }
          var full = d.text || ''
          if (full.length > acc.length) { acc = full; aiMsg.text = acc; baRenderChat() }
          var min = Math.round((Date.now() - (d.createdAt || Date.now())) / 60000)
          baSetStatus(min < 60 ? '后台处理中… 已运行 ' + min + ' 分钟' : '后台处理中… 已运行 ' + Math.floor(min / 60) + ' 小时 ' + (min % 60) + ' 分钟')
          timer = setTimeout(poll, 30000)
        })
        .catch(function () { baSetStatus('网络中断，60秒后重试…'); timer = setTimeout(poll, 60000) })
    }
    baSetStatus('连接断开，切换轮询模式…')
    timer = setTimeout(poll, 2000)
    return { abort: function () { if (timer) clearTimeout(timer) } }
  }

  /* ====== SSE 对话 ====== */
  function baScroll() { var b = document.getElementById('baChat'); if (b) b.scrollTop = b.scrollHeight }
  function baSetStatus(s) { var el = document.getElementById('baSt'); if (el) el.textContent = s || '' }

  function baSend(c, text, opts) {
    opts = opts || {}
    if (!c) return Promise.resolve()
    if (baBusy(c.id)) { toast('智能体正在回复中'); return Promise.resolve() }
    BA_BUSY[c.id] = true

    c.msgs.push({ role: 'me', text: text, ts: Date.now() })
    if (!c.autoTitle) { c.title = String(text).replace(/\s+/g, ' ').slice(0, 28); c.autoTitle = true }
    var aiMsg = { role: 'ai', text: '', ts: Date.now(), streaming: true }
    c.msgs.push(aiMsg)
    baSaveConv(c)
    baRender()
    baScroll()
    baSetStatus(opts.statusText || '正在连接…')

    var ctrl = new AbortController()
    BA_CTRL[c.id] = ctrl
    var acc = '', pollTaskId = null, finished = false
    var slowTimer = setTimeout(function () { if (!acc) baSetStatus('模型响应较慢，请稍候…') }, 22000)

    function finish(finalText, errMsg) {
      if (finished) return
      finished = true
      clearTimeout(slowTimer)
      aiMsg.text = finalText || acc || ''
      delete aiMsg.streaming
      if (errMsg) aiMsg.error = errMsg
      delete BA_CTRL[c.id]; delete BA_BUSY[c.id]; delete BA_POLL[c.id]
      baSaveConv(c); baRender(); baScroll()
      if (opts.onDone) { try { opts.onDone(aiMsg.text) } catch (e) {} }
    }

    var attachList = baActiveAttachments(c.id)
    var payload = { key: c.id, text: text, reset: !!opts.reset, sessionId: c.hxSessionId || null }
    if (attachList.length) { payload.attachments = attachList.map(function (a) { return { name: a.name, text: a.text } }); BA_ATTACH[c.id] = [] }

    return fetch(API + '/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal
    }).then(function (r) {
      if (!r.ok || !r.body) throw new Error('HTTP ' + r.status)
      var reader = r.body.getReader(), dec = new TextDecoder('utf-8'), buf = '', finalText = null, errText = null
      function pump() {
        return reader.read().then(function (res) {
          if (res.done) {
            if (finalText === null && errText === null && pollTaskId) {
              if (BA_POLL[c.id]) BA_POLL[c.id].abort()
              BA_POLL[c.id] = baPollTask(c, pollTaskId, acc, aiMsg, finish); return
            }
            finish(finalText, errText); return
          }
          buf += dec.decode(res.value, { stream: true })
          var parts = buf.split('\n\n'); buf = parts.pop() || ''
          parts.forEach(function (block) {
            block.split('\n').forEach(function (line) {
              if (line.indexOf('data:') !== 0) return
              var raw = line.slice(5).trim(); if (!raw) return
              try { var ev = JSON.parse(raw) } catch (e) { return }
              if (ev.type === 'task') { pollTaskId = ev.taskId; return }
              if (ev.type === 'delta') { acc += ev.text || ''; aiMsg.text = acc; clearTimeout(slowTimer); baSetStatus(''); baRenderChat() }
              else if (ev.type === 'status') baSetStatus(ev.text || '')
              else if (ev.type === 'session') {
                if (ev.sessionId && ev.sessionId !== c.hxSessionId) { c.hxSessionId = ev.sessionId; c.hxStoredSessionId = ev.storedSessionId || c.hxStoredSessionId; baSaveConv(c) }
                baSetStatus('已连接（' + (ev.model || '—') + '），正在思考…')
              }
              else if (ev.type === 'done') { finalText = ev.text || acc; if (ev.sessionId) { c.hxSessionId = ev.sessionId; c.hxStoredSessionId = ev.storedSessionId || c.hxStoredSessionId; baSaveConv(c) } }
              else if (ev.type === 'error') { errText = ev.message }
            })
          })
          return pump()
        })
      }
      return pump()
    }).catch(function (e) {
      if (finished) return
      if (e && e.name === 'AbortError') { finish(acc + '\n\n（已中断）'); return }
      if (pollTaskId) { baSetStatus('连接中断，切换轮询…'); BA_POLL[c.id] = baPollTask(c, pollTaskId, acc, aiMsg, finish); return }
      finish(acc || '', String(e && e.message || e))
    })
  }

  function baStop(id) {
    if (BA_CTRL[id]) { try { BA_CTRL[id].abort() } catch (_) {} delete BA_CTRL[id] }
    if (BA_POLL[id]) { try { BA_POLL[id].abort() } catch (_) {} delete BA_POLL[id] }
    delete BA_BUSY[id]
    toast('已中断')
    baRender()
  }

  function baReset(id) {
    var c = baGetConv(id)
    if (!c || baBusy(c.id)) return
    if (!confirm('重开会话会清空对话上下文，确定？')) return
    fetch(API + '/api/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: c.id }) }).catch(function () {})
    c.msgs = []; delete c.hxSessionId; delete c.hxStoredSessionId
    baSaveConv(c); baRender(); toast('会话已重置')
  }

  /* ====== 渲染 ====== */
  function baRenderSidebar() {
    var sel = document.getElementById('baProjSelect')
    if (!sel) return
    var cur = sel.value
    var projs = (store.projects || []).filter(function (p) { return p.stage !== '项目已取消' })
    sel.innerHTML = '<option value="">全部项目</option>' + projs.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name || '未命名') + ' · ' + esc(p.customer || '—') + '</option>' }).join('')
    if (cur) sel.value = cur

    var listEl = document.getElementById('baConvList')
    if (!listEl) return
    var pid = sel.value
    var convs = pid ? baConvsForProject(pid) : (store.bidAgentConvs || [])

    if (!convs.length) {
      listEl.innerHTML = '<div style="padding:24px 12px;text-align:center;color:var(--sub);font-size:13px">暂无对话<br>点击上方「新对话」开始</div>'
      return
    }

    var html = ''
    convs.forEach(function (c) {
      var on = c.id === baCurConv ? ' on' : ''
      var st = baBusy(c.id) ? '<span class="st run">运行中</span>' : ''
      var mc = (c.msgs || []).length
      var ts = ''
      try { var d = new Date(c.updatedAt || c.createdAt); ts = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0') } catch (e) {}
      var p = getProj(c.projectId)
      var pn = p ? (p.name || '—') : '通用'
      html += '<div class="ba-conv' + on + '" onclick="baOpenConv(\'' + c.id + '\')">'
        + '<div class="tt">' + esc(c.title || '未命名') + '</div>'
        + '<div class="sub">' + esc(pn) + ' · ' + mc + '条 · ' + ts + (st ? ' ' + st : '') + '</div>'
        + '<div style="margin-top:5px"><span class="del" onclick="event.stopPropagation();baDelConvAction(\'' + c.id + '\')">删除</span></div>'
        + '</div>'
    })
    listEl.innerHTML = html
  }

  function baRenderChat() {
    var body = document.getElementById('baChat')
    if (!body) return
    var c = baCurConv ? baGetConv(baCurConv) : null
    if (!c) {
      body.innerHTML = '<div class="ba-chat-empty"><div class="em">🤝</div>投标智能体<br>选择左侧对话或点击「新对话」开始<br><br>与 Hermes wordpresales 专家智能体直接对话<br>支持长时间异步处理，不会中断</div>'
      return
    }
    var html = ''
    if (!c.msgs.length) {
      html += '<div class="ba-chat-empty"><div class="em">💬</div>这是一个全新的对话<br>直接输入消息开始与投标智能体交流</div>'
    }
    c.msgs.forEach(function (m) {
      var av = m.role === 'ai' ? '🤖' : '🧑'
      if (m.streaming) {
        html += '<div class="ba-msg ' + m.role + '"><div class="av">' + av + '</div>'
          + '<div class="bb"><span id="baLive"></span><span class="ba-caret"></span>'
          + '<div class="ba-st" id="baSt"></div></div></div>'
      } else {
        var content = m.role === 'ai' ? baMd(m.text) : esc(m.text)
        var fc = m.role === 'ai' ? baFileCardsHtml(m.text) : ''
        html += '<div class="ba-msg ' + m.role + '"><div class="av">' + av + '</div>'
          + '<div class="bb">' + content + (fc || '') + (m.error ? '<div style="color:var(--bad);font-size:12px;margin-top:6px">⚠ ' + esc(m.error) + '</div>' : '') + '</div></div>'
      }
    })
    body.innerHTML = html
    baScroll()
    var live = document.getElementById('baLive')
    if (live) { var last = c.msgs[c.msgs.length - 1]; if (last && last.streaming) live.textContent = last.text || '' }
  }

  function baRenderInput() {
    var el = document.getElementById('baInputBar')
    if (!el) return
    var c = baCurConv ? baGetConv(baCurConv) : null
    var busy = c && baBusy(c.id)
    var active = !!c && !busy
    var attHtml = c ? baRenderAttachments(c.id) : ''
    var ph = c ? (busy ? '智能体正在回复中…' : '输入消息，回车发送…') : '请先创建对话'

    el.innerHTML = '<div class="ba-input">'
      + (attHtml || '')
      + '<textarea id="baInput" ' + (active ? '' : 'disabled') + ' placeholder="' + esc(ph) + '" '
      + (active ? 'onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();baSendFromInput()}"' : '') + '></textarea>'
      + '<div class="ba-tools">'
      + (active ? '<span class="ba-up-ico" title="上传文件" onclick="document.getElementById(\'baAttachInput\').click()">📎</span><input type="file" id="baAttachInput" style="display:none" onchange="baAttachFile(this)">' : '')
      + '<div class="sp"></div>'
      + (busy
        ? '<span class="ba-chip stop" onclick="baStop(\'' + (c ? c.id : '') + '\')">⏹ 停止</span>'
        : '<span class="ba-chip gen" onclick="baGenDraft()">⚡ 生成方案初稿</span>')
      + '<button class="ba-send" ' + (active ? 'onclick="baSendFromInput()"' : 'disabled') + '>发送 ➤</button>'
      + '</div></div>'
  }

  function baRender() { baRenderSidebar(); baRenderChat(); baRenderInput() }

  /* ====== 入口 ====== */
  window.baOpenConv = function (id) { baCurConv = id; baRender(); setTimeout(function () { var i = document.getElementById('baInput'); if (i) i.focus() }, 50) }
  window.baNewConvAction = function () {
    var pid = document.getElementById('baProjSelect').value
    if (!pid) { toast('请先选择项目'); return }
    var c = baNewConv(pid)
    baCurConv = c.id
    c.msgs.push({ role: 'ai', text: '新对话已创建。项目：' + (getProj(pid) || {}).name + '\n你可以直接输入消息开始交流，或点击「生成方案初稿」。', ts: Date.now() })
    baSaveConv(c); baRender()
  }
  window.baDelConvAction = function (id) { if (confirm('确定删除？')) { baDelConv(id); baRender(); toast('已删除') } }
  window.baSendFromInput = function () {
    var inp = document.getElementById('baInput'); var c = baCurConv ? baGetConv(baCurConv) : null
    if (!inp || !c) return
    var v = inp.value.trim(); if (!v && !baActiveAttachments(c.id).length) return
    inp.value = ''; baSend(c, v)
  }
  window.baGenDraft = function () {
    var c = baCurConv ? baGetConv(baCurConv) : null
    if (!c) return
    if (baBusy(c.id)) { toast('正在回复中'); return }
    var p = getProj(c.projectId) || {}
    baSend(c, '请基于本次对话内容，为项目「' + (p.name || '—') + '」（客户：' + (p.customer || '—') + '）生成完整方案初稿。\n要求：直接输出 Markdown 正文，如适合用 PPT 或 Word 展示请同时生成文件。', { statusText: '正在生成方案初稿，可能需要较长时间…' })
  }
  window.baOnProjChange = function () { baRender() }
  window.renderBidAgent = function () { baInit(); baRender() }

  var origShow = window.show
  if (origShow) { window.show = function (p) { origShow(p); if (p === 'bidagent') renderBidAgent() } }

  console.log('[bid-agent v2] loaded')
})()
