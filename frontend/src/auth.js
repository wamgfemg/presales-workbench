/* ===== 鉴权与 RBAC 前端：登录门 + 权限过滤 + 用户管理（依赖 main.js 的 openMask/closeMask/toast，及 bootApp） ===== */
(function () {
  var ME = null, MODULES = []
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] }) }
  window.canView = function (m) { if (!ME) return false; if (ME.role === 'admin') return true; return !!(ME.perms && ME.perms[m]) }
  window.canEdit = function (m) { if (!ME) return false; if (ME.role === 'admin') return true; return ME.perms && ME.perms[m] === 'edit' }
  window.currentRole = function () { return ME ? ME.role : '' }

  function api(url, opts) { return fetch(url, Object.assign({ headers: { 'content-type': 'application/json' } }, opts || {})).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j } }).catch(function () { return { status: r.status, body: {} } }) }) }

  function showLogin(msg) { document.body.classList.add('auth-pending'); var m = document.getElementById('loginMask'); if (m) m.classList.add('on'); var e = document.getElementById('loginErr'); if (e) e.textContent = msg || ''; var u = document.getElementById('loginUser'); if (u) setTimeout(function () { u.focus() }, 60) }
  function hideLogin() { var m = document.getElementById('loginMask'); if (m) m.classList.remove('on') }

  window.doLogin = function () {
    var u = document.getElementById('loginUser'), p = document.getElementById('loginPass'), err = document.getElementById('loginErr')
    var un = u.value.trim(), pw = p.value; err.textContent = ''
    if (!un || !pw) { err.textContent = '请输入用户名和密码'; return }
    var btn = document.getElementById('loginBtn'); btn.disabled = true; btn.textContent = '登录中…'
    api('/api/login', { method: 'POST', body: JSON.stringify({ username: un, password: pw }) }).then(function (r) {
      if (r.status === 200 && r.body.ok) { location.reload(); return }
      btn.disabled = false; btn.textContent = '登 录'; err.textContent = (r.body && r.body.error) || '登录失败'
    }).catch(function (e) { btn.disabled = false; btn.textContent = '登 录'; err.textContent = '网络错误：' + e.message })
  }
  window.doLogout = function () { api('/api/logout', { method: 'POST', body: '{}' }).then(function () { location.reload() }).catch(function () { location.reload() }) }

  function applyPerms() {
    document.querySelectorAll('#nav button[data-p]').forEach(function (b) {
      var p = b.getAttribute('data-p')
      if (p === 'users') { b.style.display = (ME.role === 'admin') ? '' : 'none'; return }
      if (ME.role === 'admin') return
      if (!canView(p)) b.style.display = 'none'
    })
    var su = document.getElementById('sideUser'); if (su) su.style.display = ''
    var fu = document.getElementById('curUser'); if (fu) fu.textContent = ME.username + (ME.role === 'admin' ? '（管理员）' : '')
    ;['btnPw', 'btnLogout'].forEach(function (i) { var e = document.getElementById(i); if (e) e.style.display = '' })
    if (ME.mustChange) { var t = document.getElementById('pwWarn'); if (t) t.style.display = '' }
  }

  /* ---------- 用户管理 ---------- */
  function permSummary(u) { if (u.role === 'admin') return '全部（管理员）'; var p = u.perms || {}, e = [], v = []; MODULES.forEach(function (m) { if (p[m.key] === 'edit') e.push(m.label); else if (p[m.key] === 'view') v.push(m.label) }); var s = ''; if (e.length) s += '可编辑：' + e.join('、'); if (v.length) s += (s ? '　·　' : '') + '只读：' + v.join('、'); return s || '<span style="color:var(--sub)">无（仅能登录，未授权任何模块）</span>' }
  window.renderUsers = function () {
    var el = document.getElementById('usersBody'); if (!el) return
    api('/api/users').then(function (r) {
      if (r.status !== 200) { el.innerHTML = '<div class="card"><div class="empty">' + esc((r.body && r.body.error) || '无权访问') + '</div></div>'; return }
      MODULES = r.body.modules || MODULES; var users = r.body.users || []
      var rows = users.map(function (u) {
        return '<tr>' +
          '<td><b>' + esc(u.username) + '</b></td>' +
          '<td>' + (u.role === 'admin' ? '<span class="tag" style="background:#eef3fd;color:#1c5ed8">管理员</span>' : '<span class="tag">普通用户</span>') + '</td>' +
          '<td>' + (u.active === false ? '<span class="tag" style="background:#fde8ef;color:#d6336c">已禁用</span>' : '<span class="tag" style="background:#e6f4ea;color:#2f9e44">正常</span>') + '</td>' +
          '<td style="font-size:12px;color:#414a5f">' + permSummary(u) + '</td>' +
          '<td style="white-space:nowrap">' +
          (u.role === 'user' ? '<button class="btn sm ghost" onclick="editPerms(\'' + u.id + '\')">权限</button> ' : '') +
          '<button class="btn sm ghost" onclick="resetUserPw(\'' + u.id + '\',\'' + esc(u.username) + '\')">重置密码</button> ' +
          '<button class="btn sm ghost" onclick="toggleUser(\'' + u.id + '\',' + (u.active === false ? 'true' : 'false') + ')">' + (u.active === false ? '启用' : '禁用') + '</button> ' +
          '<button class="btn sm danger" onclick="delUser(\'' + u.id + '\',\'' + esc(u.username) + '\')">删除</button>' +
          '</td></tr>'
      }).join('')
      el.innerHTML = '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0">用户管理</h3><button class="btn" onclick="openAddUser()">＋ 新增用户</button></div>' +
        '<div style="overflow-x:auto"><table><tr><th>用户名</th><th>角色</th><th>状态</th><th>权限概览</th><th style="width:300px">操作</th></tr>' + rows + '</table></div>' +
        '<div class="hint" style="margin-top:10px">管理员拥有全部权限并可管理用户；普通用户按模块授予「只读 / 可编辑」——未授权模块在其菜单中隐藏，写操作由服务端拦截。</div></div>'
    })
  }
  var _editId = null
  window.editPerms = function (id) { _editId = id; api('/api/users').then(function (r) { var u = (r.body.users || []).find(function (x) { return x.id === id }); if (!u) return; document.getElementById('permsBody').innerHTML = MODULES.map(function (m) { var lvl = (u.perms || {})[m.key] || 'none'; return '<tr><td>' + m.label + '</td><td>' + ['none:无', 'view:只读', 'edit:可编辑'].map(function (x) { var v = x.split(':'); return '<label class="pr"><input type="radio" name="pm_' + m.key + '" value="' + v[0] + '" ' + (lvl === v[0] ? 'checked' : '') + '>' + v[1] + '</label>' }).join('') + '</td></tr>' }).join(''); document.getElementById('permsTitle').textContent = '配置权限 · ' + u.username; openMask('mPerms') }) }
  window.savePerms = function () { var perms = {}; MODULES.forEach(function (m) { var el = document.querySelector('input[name="pm_' + m.key + '"]:checked'); if (el && el.value !== 'none') perms[m.key] = el.value }); api('/api/users/' + _editId, { method: 'PUT', body: JSON.stringify({ perms: perms }) }).then(function (r) { if (r.status === 200) { closeMask('mPerms'); toast('权限已保存'); renderUsers() } else toast((r.body && r.body.error) || '保存失败') }) }

  function defaultPerms() { var p = {}; MODULES.forEach(function (m) { p[m.key] = 'view' }); p.projects = 'edit'; p.contracts = 'edit'; return p }
  window.openAddUser = function () { ['auName', 'auPw'].forEach(function (i) { var e = document.getElementById(i); if (e) e.value = '' }); var r = document.querySelector('input[name=auRole][value=user]'); if (r) r.checked = true; document.getElementById('auErr').textContent = ''; openMask('mAddUser') }
  window.submitAddUser = function () {
    var username = document.getElementById('auName').value.trim(), pw = document.getElementById('auPw').value, roleEl = document.querySelector('input[name=auRole]:checked'), role = roleEl ? roleEl.value : 'user', err = document.getElementById('auErr'); err.textContent = ''
    api('/api/users', { method: 'POST', body: JSON.stringify({ username: username, password: pw, role: role, perms: role === 'user' ? defaultPerms() : {} }) }).then(function (r) { if (r.status === 200) { closeMask('mAddUser'); toast('已创建用户'); renderUsers() } else err.textContent = (r.body && r.body.error) || '创建失败' })
  }
  window.resetUserPw = function (id, name) { var np = prompt('为「' + name + '」设置新密码（至少 6 位，对方下次登录生效）：'); if (np === null) return; if (np.length < 6) { toast('密码至少 6 位'); return } api('/api/users/' + id, { method: 'PUT', body: JSON.stringify({ password: np }) }).then(function (r) { toast(r.status === 200 ? '密码已重置' : ((r.body && r.body.error) || '失败')) }) }
  window.toggleUser = function (id, enable) { api('/api/users/' + id, { method: 'PUT', body: JSON.stringify({ active: !!enable }) }).then(function (r) { if (r.status === 200) { toast('已' + (enable ? '启用' : '禁用')); renderUsers() } else toast((r.body && r.body.error) || '失败') }) }
  window.delUser = function (id, name) { if (!confirm('确定删除用户「' + name + '」？')) return; api('/api/users/' + id, { method: 'DELETE' }).then(function (r) { if (r.status === 200) { toast('已删除'); renderUsers() } else toast((r.body && r.body.error) || '失败') }) }

  window.openPw = function () { ['pwOld', 'pwNew', 'pwNew2'].forEach(function (i) { var e = document.getElementById(i); if (e) e.value = '' }); document.getElementById('pwErr').textContent = ''; openMask('mPw') }
  window.submitPw = function () { var old = document.getElementById('pwOld').value, nw = document.getElementById('pwNew').value, n2 = document.getElementById('pwNew2').value, err = document.getElementById('pwErr'); err.textContent = ''; if (nw.length < 6) { err.textContent = '新密码至少 6 位'; return } if (nw !== n2) { err.textContent = '两次输入不一致'; return } api('/api/password', { method: 'POST', body: JSON.stringify({ old: old, new: nw }) }).then(function (r) { if (r.status === 200) { closeMask('mPw'); toast('密码已修改'); var t = document.getElementById('pwWarn'); if (t) t.style.display = 'none' } else err.textContent = (r.body && r.body.error) || '失败' }) }

  function authBoot() {
    fetch('/api/me', { cache: 'no-store' }).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j } }).catch(function () { return { status: r.status, body: {} } }) }).then(function (r) {
      if (r.status === 200 && r.body.ok) {
        ME = r.body.user; MODULES = r.body.modules || []
        document.body.classList.remove('auth-pending'); hideLogin(); applyPerms()
        if (typeof bootApp === 'function') bootApp()
        if (ME.role !== 'admin' && !canView('dash')) { var f = MODULES.find(function (m) { return canView(m.key) }); if (f) show(f.key) }
      } else showLogin()
    }).catch(function (e) { showLogin('无法连接服务器：' + (e && e.message)) })
  }
  document.addEventListener('keydown', function (e) { var m = document.getElementById('loginMask'); if (m && m.classList.contains('on') && e.key === 'Enter') { e.preventDefault(); doLogin() } })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', authBoot); else authBoot()
})()
