/* 자체 실행반 — 앱 로직
   시연 모드: 브라우저(localStorage)에 저장.  시트 연결 시: Apps Script 웹앱(JSONP)과 동기화. */
(function () {
  'use strict';

  var KEY_CFG = 'sb.cfg.v1';
  var KEY_DEMO = 'sb.demo.v1';

  var cfg = loadJSON(KEY_CFG, { apiUrl: '', myName: '박종익' });
  var mode = 'demo';
  var state = null;      // 지금 보고 있는 달
  var demoStore = null;  // 시연 모드의 여러 달 저장소
  var goalTarget = null; // 목표 수정 중인 참가자

  /* ---------- 저장소 ---------- */
  function loadJSON(k, fallback) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function seedDemo() {
    var s = window.SB_SNAPSHOT;
    return {
      active: s.month,
      months: [{
        month: s.month, period: s.period, weeks: s.weeks, nextLabel: s.nextLabel,
        members: JSON.parse(JSON.stringify(s.members))
      }]
    };
  }

  function getDemo() {
    if (!demoStore) {
      demoStore = loadJSON(KEY_DEMO, null) || seedDemo();
      if (!demoStore.months || !demoStore.months.length) demoStore = seedDemo();
    }
    return demoStore;
  }
  function saveDemo() { saveJSON(KEY_DEMO, demoStore); }

  /* ---------- 유틸 ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pct(r) { return Math.max(0, Math.min(1, Number(r) || 0)); }
  function pctText(r) { return Math.round(pct(r) * 100) + '%'; }

  function parseMonthTitle(t) {
    var m = String(t || '').match(/(\d{2,4})\s*년\s*(\d{1,2})\s*월/);
    if (!m) return null;
    var y = parseInt(m[1], 10); if (y < 100) y += 2000;
    return { year: y, month: parseInt(m[2], 10), prefix: m[1] };
  }
  function nextMonthTitle(t) {
    var p = parseMonthTitle(t);
    if (!p) return '';
    var y = p.year, mo = p.month + 1;
    if (mo > 12) { mo = 1; y += 1; }
    var prefix = p.prefix.length === 2 ? String(y % 100).padStart(2, '0') : String(y);
    return prefix + '년 ' + mo + '월';
  }
  function shortMonthLabel(t) {
    var p = parseMonthTitle(t);
    return p ? p.month + '월' : t;
  }
  function countSundays(year, month) {
    var last = new Date(year, month, 0).getDate(), n = 0;
    for (var d = 1; d <= last; d++) if (new Date(year, month - 1, d).getDay() === 0) n++;
    return n;
  }
  function currentWeekIndex() {
    var p = parseMonthTitle(state && state.month);
    if (!p) return 1;
    var now = new Date();
    if (now.getFullYear() !== p.year || now.getMonth() + 1 !== p.month) return 0;
    return Math.min(state.weeks, Math.floor((now.getDate() - 1) / 7) + 1);
  }
  function toast(msg, isErr) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* ---------- Apps Script 통신 (JSONP: CORS 없이 동작) ---------- */
  function api(params, timeout) {
    return new Promise(function (resolve, reject) {
      var base = (cfg.apiUrl || '').trim();
      if (!base) return reject(new Error('웹앱 URL이 없습니다'));
      var cb = 'sb_cb_' + Math.random().toString(36).slice(2);
      var url = base + (base.indexOf('?') >= 0 ? '&' : '?');
      var qs = [];
      Object.keys(params).forEach(function (k) {
        qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
      });
      qs.push('callback=' + cb, '_=' + Date.now());
      var s = document.createElement('script');
      var done = false;
      var timer = setTimeout(function () {
        if (done) return; done = true;
        cleanup(); reject(new Error('응답 시간 초과'));
      }, timeout || 20000);
      function cleanup() {
        clearTimeout(timer);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      window[cb] = function (res) {
        if (done) return; done = true; cleanup();
        if (!res || res.ok === false) {
          reject(new Error((res && (res.error || res.message)) || '시트 응답 오류'));
        } else {
          resolve(res.data || res);
        }
      };
      s.onerror = function () {
        if (done) return; done = true; cleanup();
        reject(new Error('웹앱에 연결하지 못했습니다'));
      };
      s.src = url + qs.join('&');
      document.head.appendChild(s);
    });
  }

  /* ---------- 상태 적용 ---------- */
  function applyMonthData(d) {
    state = {
      month: d.month,
      months: (d.months || (state && state.months) || [d.month]).slice(),
      period: d.period || '',
      weeks: d.weeks || 5,
      nextLabel: d.nextLabel || shortMonthLabel(nextMonthTitle(d.month)),
      members: (d.members || []).map(function (m) {
        var checks = (m.checks || []).slice();
        while (checks.length < (d.weeks || 5)) checks.push(false);
        var total = Number(m.total) || 0;
        var achieved = checks.filter(Boolean).length;
        var rate = (typeof m.rate === 'number' && !isNaN(m.rate)) ? m.rate : (total ? achieved / total : 0);
        return {
          row: m.row || null, name: m.name, goal: m.goal || '', total: total,
          rate: rate, checks: checks, renew: !!m.renew
        };
      })
    };
    if (state.months.indexOf(state.month) < 0) state.months.unshift(state.month);
    render();
  }

  function localRecalc(m) {
    var achieved = m.checks.filter(Boolean).length;
    m.rate = m.total ? achieved / m.total : 0;
    return m;
  }

  function activeDemoMonth() {
    var store = getDemo();
    for (var i = 0; i < store.months.length; i++) if (store.months[i].month === store.active) return store.months[i];
    return store.months[0];
  }

  function loadDemo() {
    var d = activeDemoMonth();
    applyMonthData({
      month: d.month, months: demoStore.months.map(function (x) { return x.month; }),
      period: d.period, weeks: d.weeks, nextLabel: d.nextLabel, members: d.members
    });
  }

  async function loadLive(month) {
    var d = await api(month ? { action: 'get', month: month } : { action: 'get' });
    applyMonthData(d);
  }

  async function refresh() {
    try {
      if (mode === 'live') await loadLive(state ? state.month : null);
      else loadDemo();
    } catch (e) {
      toast(e.message || '새로고침 실패', true);
      setMode('demo', '시트 연결이 끊겨 시연 데이터로 표시합니다');
    }
  }

  /* ---------- 렌더 ---------- */
  function render() {
    renderMode();
    renderChips();
    renderSummary();
    renderChart();
    renderMembers();
  }

  function renderMode() {
    var b = $('modeBanner'), t = $('modeText'), btn = $('connectBtn');
    $('infoMode').textContent = mode === 'live' ? '시트 연결' : '시연';
    if (mode === 'live') {
      b.classList.add('live');
      t.textContent = '시트와 연결됨 — 체크가 바로 저장됩니다';
      btn.textContent = '설정';
    } else {
      b.classList.remove('live');
      t.textContent = '시연 모드 — 기기에만 저장됩니다';
      btn.textContent = '시트 연결';
    }
    $('infoSnapshot').textContent = (window.SB_SNAPSHOT && window.SB_SNAPSHOT.capturedAt || '').slice(0, 10);
  }

  function renderChips() {
    var box = $('monthChips');
    box.innerHTML = (state.months || []).map(function (m) {
      return '<button class="chip' + (m === state.month ? ' on' : '') + '" data-month="' + esc(m) + '">' + esc(m) + '</button>';
    }).join('');
    $('periodLine').textContent = state.period || state.month;
  }

  function renderSummary() {
    var ms = state.members, checks = 0, goals = 0, renew = 0;
    ms.forEach(function (m) {
      checks += m.checks.filter(Boolean).length;
      goals += m.total || 0;
      if (m.renew) renew++;
    });
    var rate = goals ? checks / goals : 0;
    var C = 2 * Math.PI * 52;
    $('ringFill').style.strokeDasharray = C.toFixed(1);
    $('ringFill').style.strokeDashoffset = (C * (1 - pct(rate))).toFixed(1);
    $('sumRate').textContent = pctText(rate);
    $('sumMembers').textContent = ms.length;
    $('sumChecks').textContent = checks + '/' + goals;
    $('sumRenew').textContent = renew;
    var wi = currentWeekIndex();
    $('sumWeekSub').textContent = wi ? '이번 주' : '이번 달';
    $('sumWeek').textContent = wi ? wi + '주차' : state.month.replace(/\s/g, '').replace('년', '.').replace('월', '');
    $('listCount').textContent = ms.length;
    $('sheetLabel').textContent = mode === 'live' ? '연결된 시트' : '26년 11월 자체 실행반';
    $('infoSheet').textContent = mode === 'live' ? '연결됨' : '26년 11월 자체 실행반';
  }

  function orderedMembers() {
    var list = state.members.slice();
    var me = (cfg.myName || '').trim();
    if (!me) return list;
    return list.sort(function (a, b) {
      var am = a.name === me ? 0 : 1, bm = b.name === me ? 0 : 1;
      return am - bm;
    });
  }

  function renderChart() {
    var box = $('chart');
    var sorted = state.members.slice().sort(function (a, b) { return pct(b.rate) - pct(a.rate) || a.name.localeCompare(b.name, 'ko'); });
    if (!sorted.length) { box.innerHTML = '<p class="hint">참가자가 없습니다.</p>'; return; }
    box.innerHTML = sorted.map(function (m) {
      var w = Math.round(pct(m.rate) * 100);
      return '<button class="bar-row" data-jump="' + esc(m.name) + '">' +
        '<span class="bar-name">' + esc(m.name) + '</span>' +
        '<span class="bar-track"><span class="bar-fill' + (pct(m.rate) >= 1 ? ' full' : '') + '" style="width:' + w + '%"></span></span>' +
        '<span class="bar-val">' + pctText(m.rate) + '</span></button>';
    }).join('');
  }

  function memberCard(m) {
    var me = (cfg.myName || '').trim();
    var isMe = me && m.name === me;
    var wi = currentWeekIndex();
    var weeks = '';
    for (var i = 0; i < state.weeks; i++) {
      var on = !!m.checks[i];
      weeks += '<button class="week-btn' + (on ? ' on' : '') + (wi === i + 1 ? ' now' : '') + '" data-act="week" data-i="' + i + '" data-name="' + esc(m.name) + '" aria-pressed="' + on + '">' +
        '<span class="n">' + (on ? '✓' : (i + 1)) + '</span>' +
        '<span class="t">' + (i + 1) + '주</span></button>';
    }
    var achieved = m.checks.filter(Boolean).length;
    return '<article class="member' + (isMe ? ' me' : '') + '" id="m-' + encodeURIComponent(m.name) + '">' +
      '<div class="member-top">' +
        '<span class="member-name">' + esc(m.name) + '</span>' +
        (isMe ? '<span class="badge">나</span>' : '') +
        (m.renew ? '<span class="badge renew">연장</span>' : '') +
        '<span class="member-rate' + (pct(m.rate) >= 1 ? ' full' : '') + '">' + pctText(m.rate) + '</span>' +
      '</div>' +
      '<div class="goal-line' + (m.goal ? '' : ' empty') + '">' +
        '<span class="goal-text">' + (m.goal ? esc(m.goal) : '목표 미입력') + '</span>' +
        '<button class="edit-btn" data-act="edit" data-name="' + esc(m.name) + '">수정</button>' +
      '</div>' +
      '<div class="weeks">' + weeks + '</div>' +
      '<div class="renew-row">' +
        '<button class="renew-toggle' + (m.renew ? ' on' : '') + '" data-act="renew" data-name="' + esc(m.name) + '" aria-pressed="' + m.renew + '">' +
          '<span class="box">✓</span>다음 달도 참여</button>' +
        '<span class="member-note">달성 ' + achieved + '/' + (m.total || 0) + ' · 총 목표 ' + (m.total || 0) + '회</span>' +
      '</div>' +
    '</article>';
  }

  function renderMembers() {
    $('memberList').innerHTML = orderedMembers().map(memberCard).join('');
  }

  /* ---------- 동작 ---------- */
  function findMember(name) {
    for (var i = 0; i < state.members.length; i++) if (state.members[i].name === name) return state.members[i];
    return null;
  }

  async function toggleWeek(name, idx) {
    var m = findMember(name);
    if (!m) return;
    var next = !m.checks[idx];
    m.checks[idx] = next;
    localRecalc(m);
    renderSummary(); renderChart(); renderMembers();
    if (mode === 'demo') {
      var dm = activeDemoMonth();
      var dmm = dm.members.filter(function (x) { return x.name === name; })[0];
      if (dmm) { dmm.checks = m.checks.slice(); dmm.rate = m.rate; }
      saveDemo();
      return;
    }
    try {
      var d = await api({ action: 'toggleCheck', month: state.month, name: name, week: idx + 1 });
      applyMonthData(d);
    } catch (e) {
      m.checks[idx] = !next; localRecalc(m);
      renderSummary(); renderChart(); renderMembers();
      toast(e.message || '저장 실패', true);
    }
  }

  async function toggleRenew(name) {
    var m = findMember(name);
    if (!m) return;
    m.renew = !m.renew;
    renderMembers(); renderSummary();
    if (mode === 'demo') {
      var dm = activeDemoMonth();
      var dmm = dm.members.filter(function (x) { return x.name === name; })[0];
      if (dmm) dmm.renew = m.renew;
      saveDemo();
      return;
    }
    try {
      var d = await api({ action: 'setRenew', month: state.month, name: name, value: m.renew ? 'true' : 'false' });
      applyMonthData(d);
    } catch (e) {
      m.renew = !m.renew; renderMembers(); renderSummary();
      toast(e.message || '저장 실패', true);
    }
  }

  function openGoal(name) {
    goalTarget = name;
    var m = findMember(name);
    if (!m) return;
    $('goalTitle').textContent = name + ' — 목표 수정';
    $('goalText').value = m.goal || '';
    $('goalTotal').value = m.total || state.weeks;
    openSheet('goalSheet');
    setTimeout(function () { $('goalText').focus(); }, 220);
  }

  async function saveGoal() {
    var name = goalTarget;
    var m = findMember(name);
    if (!m) return;
    var goal = $('goalText').value.trim();
    var total = Math.max(1, Math.min(31, parseInt($('goalTotal').value, 10) || state.weeks));
    closeSheet('goalSheet');
    m.goal = goal; m.total = total; localRecalc(m);
    renderSummary(); renderChart(); renderMembers();
    if (mode === 'demo') {
      var dm = activeDemoMonth();
      var dmm = dm.members.filter(function (x) { return x.name === name; })[0];
      if (dmm) { dmm.goal = goal; dmm.total = total; dmm.rate = m.rate; }
      saveDemo();
      toast('목표를 저장했습니다 (시연)');
      return;
    }
    try {
      var d = await api({ action: 'updateGoal', month: state.month, name: name, goal: goal, total: total });
      applyMonthData(d);
      toast('시트에 저장했습니다');
    } catch (e) { toast(e.message || '저장 실패', true); }
  }

  function openAdd() {
    $('addName').value = ''; $('addGoal').value = ''; $('addTotal').value = state.weeks;
    openSheet('addSheet');
    setTimeout(function () { $('addName').focus(); }, 220);
  }

  async function saveAdd() {
    var name = $('addName').value.trim();
    var goal = $('addGoal').value.trim();
    var total = Math.max(1, Math.min(31, parseInt($('addTotal').value, 10) || state.weeks));
    if (!name) { toast('이름을 입력하세요', true); return; }
    if (findMember(name)) { toast('이미 있는 이름입니다', true); return; }
    closeSheet('addSheet');

    if (mode === 'demo') {
      var dm = activeDemoMonth();
      var row = dm.members.reduce(function (a, x) { return Math.max(a, x.row || 0); }, 2) + 1;
      dm.members.push({ row: row, name: name, goal: goal, total: total, rate: 0,
        checks: new Array(state.weeks).fill(false), renew: false });
      saveDemo();
      loadDemo();
      toast(name + ' 님을 추가했습니다 (시연)');
      return;
    }
    try {
      var d = await api({ action: 'addMember', month: state.month, name: name, goal: goal, total: total });
      applyMonthData(d);
      toast(name + ' 님을 시트에 추가했습니다');
    } catch (e) { toast(e.message || '추가 실패', true); }
  }

  async function openRollover() {
    var target = nextMonthTitle(state.month);
    var preview;
    if (mode === 'demo') {
      var carried = state.members.filter(function (m) { return m.renew; });
      var p = parseMonthTitle(target);
      preview = {
        targetTitle: target, exists: (state.months || []).indexOf(target) >= 0,
        period: p ? '기간 (' + p.month + '/1 ~ ' + p.month + '/' + lastSunday(p.year, p.month) + ')' : '',
        weeks: p ? countSundays(p.year, p.month) : state.weeks,
        members: carried.map(function (m) { return { name: m.name, goal: m.goal, total: m.total }; })
      };
    } else {
      try { preview = await api({ action: 'rolloverPreview', month: state.month }); }
      catch (e) { toast(e.message || '미리보기를 불러오지 못했습니다', true); return; }
    }
    $('rollSummary').innerHTML = '<strong>' + esc(preview.targetTitle) + '</strong> 시트로 ' + preview.members.length + '명을 넘깁니다.' +
      (preview.exists ? ' <span style="color:var(--warn)">이미 있는 시트라 뒤에 이어 붙입니다.</span>' : ' 새 시트를 만듭니다.') +
      (preview.period ? '<br><span class="hint">' + esc(preview.period) + ' · ' + preview.weeks + '주</span>' : '');
    $('rollList').innerHTML = preview.members.length
      ? preview.members.map(function (m, i) {
          return '<div class="roll-item"><span class="num">' + (i + 1) + '</span><span>' + esc(m.name) + '</span><span class="g">' + esc(m.goal || '목표 미입력') + '</span></div>';
        }).join('')
      : '<div class="roll-empty">연장여부가 체크된 참가자가 없습니다.</div>';
    $('rollConfirmBtn').disabled = !preview.members.length;
    $('rollConfirmBtn').dataset.target = preview.targetTitle;
    openSheet('rollSheet');
  }

  function lastSunday(year, month) {
    var last = new Date(year, month, 0).getDate();
    for (var d = last; d >= last - 6; d--) if (new Date(year, month - 1, d).getDay() === 0) return d;
    return last;
  }

  async function confirmRollover() {
    var target = $('rollConfirmBtn').dataset.target;
    if (!target) return;
    var n = state.members.filter(function (m) { return m.renew; }).length;
    if (!confirm(target + ' 시트를 만들고 ' + n + '명을 이월할까요? 원본 시트의 지난 달 데이터는 그대로 남습니다.')) return;
    closeSheet('rollSheet');

    if (mode === 'demo') {
      var p = parseMonthTitle(target);
      var weeks = p ? countSundays(p.year, p.month) : state.weeks;
      var carried = state.members.filter(function (m) { return m.renew; }).map(function (m) {
        return { row: null, name: m.name, goal: m.goal, total: Math.min(m.total || weeks, weeks), rate: 0,
          checks: new Array(weeks).fill(false), renew: false };
      });
      getDemo();
      var exists = demoStore.months.filter(function (x) { return x.month === target; })[0];
      if (exists) {
        carried.forEach(function (c) {
          if (!exists.members.some(function (x) { return x.name === c.name; })) exists.members.push(c);
        });
      } else {
        demoStore.months.unshift({
          month: target,
          period: '기간 (' + p.month + '/1 ~ ' + p.month + '/' + lastSunday(p.year, p.month) + ')',
          weeks: weeks, nextLabel: shortMonthLabel(nextMonthTitle(target)), members: carried
        });
      }
      demoStore.active = target;
      saveDemo();
      loadDemo();
      toast(target + ' 시트를 만들었습니다 (시연)');
      return;
    }
    try {
      var d = await api({ action: 'rollover', month: state.month, confirm: 'yes' });
      toast(d.targetTitle + ' 시트에 ' + (d.members || []).length + '명을 이월했습니다');
      if (d.months) state.months = d.months;
      await loadLive(d.targetTitle);
    } catch (e) { toast(e.message || '이월 실패', true); }
  }

  /* ---------- 월 전환 ---------- */
  async function switchMonth(month) {
    if (month === state.month) return;
    if (mode === 'demo') {
      getDemo();
      demoStore.active = month;
      saveDemo();
      loadDemo();
      return;
    }
    try { await loadLive(month); } catch (e) { toast(e.message || '해당 달을 불러오지 못했습니다', true); }
  }

  /* ---------- 시트 연결 ---------- */
  function setMode(m, note) {
    mode = m;
    if (note) $('modeText').textContent = note;
    renderMode();
  }

  async function testConnection(url) {
    var prev = cfg.apiUrl;
    cfg.apiUrl = url;
    try {
      var d = await api({ action: 'ping' }, 15000);
      cfg.apiUrl = prev;
      return d;
    } catch (e) {
      cfg.apiUrl = prev;
      throw e;
    }
  }

  async function saveUrl() {
    var url = $('apiUrlInput').value.trim();
    var res = $('testResult');
    if (!url) { res.className = 'test-result err'; res.textContent = 'URL을 입력하세요.'; return; }
    if (/\/dev$/.test(url)) {
      res.className = 'test-result err';
      res.textContent = '"/dev" 주소는 본인만 열 수 있습니다. 배포 화면의 "/exec" 주소를 넣어 주세요.';
      return;
    }
    res.className = 'test-result'; res.textContent = '연결 확인 중…';
    try {
      var d = await testConnection(url);
      cfg.apiUrl = url; saveJSON(KEY_CFG, cfg);
      res.className = 'test-result ok';
      res.textContent = '연결 성공 — ' + (d.spreadsheet || '시트') + ' (' + (d.months || []).length + '개 월)';
      setMode('live');
      await loadLive();
      toast('시트에 연결했습니다');
    } catch (e) {
      res.className = 'test-result err';
      res.textContent = '연결 실패: ' + (e.message || '') + ' — 배포 설정에서 액세스를 "모든 사용자"로 두었는지 확인하세요.';
    }
  }

  function clearUrl() {
    cfg.apiUrl = ''; saveJSON(KEY_CFG, cfg);
    $('apiUrlInput').value = '';
    $('testResult').className = 'test-result';
    $('testResult').textContent = '연결을 해제했습니다. 시연 데이터로 표시합니다.';
    setMode('demo');
    loadDemo();
  }

  /* ---------- 시트 열기/닫기 ---------- */
  function openSheet(id) { $(id).hidden = false; document.body.style.overflow = 'hidden'; }
  function closeSheet(id) { $(id).hidden = true; document.body.style.overflow = ''; }

  /* ---------- 이벤트 ---------- */
  function bind() {
    $('settingsBtn').addEventListener('click', function () {
      $('apiUrlInput').value = cfg.apiUrl || '';
      $('myNameInput').value = cfg.myName || '';
      $('testResult').textContent = '';
      openSheet('settingsSheet');
    });
    $('connectBtn').addEventListener('click', function () {
      if (mode === 'live') { $('settingsBtn').click(); return; }
      $('settingsBtn').click();
      setTimeout(function () { $('apiUrlInput').focus(); }, 250);
    });
    $('refreshBtn').addEventListener('click', function () { refresh(); toast('새로고침했습니다'); });
    $('saveUrlBtn').addEventListener('click', saveUrl);
    $('clearUrlBtn').addEventListener('click', clearUrl);
    $('testBtn').addEventListener('click', async function () {
      var url = $('apiUrlInput').value.trim();
      var res = $('testResult');
      if (!url) { res.className = 'test-result err'; res.textContent = 'URL을 입력하세요.'; return; }
      res.className = 'test-result'; res.textContent = '연결 확인 중…';
      try {
        var d = await testConnection(url);
        res.className = 'test-result ok';
        res.textContent = '연결 성공 — ' + (d.spreadsheet || '시트') + ' / 탭: ' + (d.months || []).join(', ');
      } catch (e) {
        res.className = 'test-result err';
        res.textContent = '연결 실패: ' + (e.message || '알 수 없는 오류');
      }
    });
    $('myNameInput').addEventListener('change', function () {
      cfg.myName = $('myNameInput').value.trim();
      saveJSON(KEY_CFG, cfg);
      render();
    });
    $('resetDemoBtn').addEventListener('click', function () {
      if (!confirm('시연 데이터를 처음 스냅샷 상태로 되돌릴까요?')) return;
      localStorage.removeItem(KEY_DEMO);
      demoStore = null;
      if (mode === 'demo') loadDemo();
      toast('시연 데이터를 초기화했습니다');
    });
    $('addBtn').addEventListener('click', openAdd);
    $('addSaveBtn').addEventListener('click', saveAdd);
    $('goalSaveBtn').addEventListener('click', saveGoal);
    $('rolloverBtn').addEventListener('click', openRollover);
    $('rollConfirmBtn').addEventListener('click', confirmRollover);

    document.querySelectorAll('[data-close]').forEach(function (el) {
      el.addEventListener('click', function () { closeSheet(el.dataset.close); });
    });
    document.querySelectorAll('.sheet-backdrop').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target === el) closeSheet(el.id);
      });
    });

    $('monthChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-month]');
      if (b) switchMonth(b.dataset.month);
    });

    $('chart').addEventListener('click', function (e) {
      var b = e.target.closest('[data-jump]');
      if (!b) return;
      var card = document.getElementById('m-' + encodeURIComponent(b.dataset.jump));
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('flash');
      setTimeout(function () { card.classList.remove('flash'); }, 1200);
    });

    $('memberList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.dataset.act, name = b.dataset.name;
      if (act === 'week') toggleWeek(name, parseInt(b.dataset.i, 10));
      else if (act === 'edit') openGoal(name);
      else if (act === 'renew') toggleRenew(name);
    });
  }

  /* ---------- 시작 ---------- */
  async function init() {
    bind();
    getDemo();
    $('apiUrlInput').value = cfg.apiUrl || '';
    $('myNameInput').value = cfg.myName || '';
    if (cfg.apiUrl) {
      mode = 'live';
      try { await loadLive(); return; }
      catch (e) {
        mode = 'demo';
        loadDemo();
        toast('시트에 연결하지 못해 시연 데이터로 표시합니다', true);
        return;
      }
    }
    mode = 'demo';
    loadDemo();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
