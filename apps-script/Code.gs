/**
 * 자체 실행반 — Google Apps Script 웹앱 API
 * ------------------------------------------------------------------
 * 설치(1분)
 *  1) 구글 시트 '26년 11월 자체 실행반'을 연다.
 *  2) 메뉴 [확장 프로그램] > [Apps Script] 를 누르고 이 파일 내용 전체를 붙여 넣는다.
 *  3) 오른쪽 위 [배포] > [새 배포] > 유형 '웹 앱'
 *     - 설명: 실행반 API
 *     - 다음 사용자로 실행: 나
 *     - 액세스 권한: 모든 사용자
 *     > [배포] 후 나오는 '웹 앱 URL'(.../exec)을 복사한다.
 *  4) 실행반 웹앱(https://mujusang.github.io/silhaengban/) > ⚙ 설정 > URL 붙여넣고 [저장].
 *
 * 원칙
 *  - 기존 멤버 데이터와 수식을 덮어쓰지 않는다. 쓰기는 '그 칸'만 한다.
 *  - 열 위치는 헤더 이름(이름·목표·총 목표·달성률·N주·연장여부)으로 찾는다. 달마다 열 구성이 달라도 동작한다.
 *  - 새 달 시트를 만들 때만 새 탭을 생성하고, 지난 달 시트는 건드리지 않는다.
 */

var CONFIG = {
  // 비워 두면 이 스크립트가 붙어 있는 스프레드시트를 사용합니다.
  // 독립 스크립트로 만들었다면 시트 ID를 넣으세요.
  SPREADSHEET_ID: '',
  MONTH_PATTERN: /^\s*(\d{2,4})\s*년\s*(\d{1,2})\s*월\s*$/,
  TZ: 'Asia/Seoul'
};

/* =====================  진입점  ===================== */

function doGet(e) {
  var p = (e && e.parameter) ? e.parameter : {};
  return respond_(route_(p), p.callback);
}

function doPost(e) {
  var p = {};
  try {
    if (e && e.postData && e.postData.contents) p = JSON.parse(e.postData.contents) || {};
  } catch (err) {
    p = {};
  }
  if (e && e.parameter) {
    for (var k in e.parameter) if (!(k in p)) p[k] = e.parameter[k];
  }
  return respond_(route_(p), p.callback);
}

function route_(p) {
  var action = String(p.action || 'get').trim();
  try {
    switch (action) {
      case 'ping': return ok_(ping_());
      case 'months': return ok_({ months: monthTitles_() });
      case 'get': return ok_(monthData_(p.month));
      case 'toggleCheck': return ok_(toggleCheck_(p.month, p.name, p.week));
      case 'setRenew': return ok_(setRenew_(p.month, p.name, p.value));
      case 'updateGoal': return ok_(updateGoal_(p.month, p.name, p.goal, p.total));
      case 'addMember': return ok_(addMember_(p.month, p.name, p.goal, p.total));
      case 'rolloverPreview': return ok_(rolloverPreview_(p.month));
      case 'rollover': return ok_(rollover_(p.month, p.confirm));
      default:
        return { ok: false, error: '알 수 없는 action: ' + action };
    }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function ok_(data) { return { ok: true, data: data }; }

function respond_(result, callback) {
  var json = JSON.stringify(result);
  if (callback && /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(String(callback))) {
    return ContentService.createTextOutput(String(callback) + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/* =====================  시트·레이아웃  ===================== */

function ss_() {
  var id = CONFIG.SPREADSHEET_ID || (PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '');
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('스프레드시트에 연결되지 않았습니다. CONFIG.SPREADSHEET_ID나 스크립트 속성 SPREADSHEET_ID를 채워 주세요.');
  return active;
}

function monthTitles_() {
  var sheets = ss_().getSheets(), list = [];
  for (var i = 0; i < sheets.length; i++) {
    var t = sheets[i].getName().trim();
    var m = t.match(CONFIG.MONTH_PATTERN);
    if (!m) continue;
    var y = parseInt(m[1], 10); if (y < 100) y += 2000;
    list.push({ title: t, year: y, month: parseInt(m[2], 10) });
  }
  list.sort(function (a, b) { return (b.year - a.year) || (b.month - a.month); });
  return list.map(function (x) { return x.title; });
}

function sheetByMonth_(month) {
  var ss = ss_();
  var titles = monthTitles_();
  var want = String(month || '').trim() || (titles[0] || '');
  if (!want) throw new Error('시트에 "26년 11월" 형식의 탭이 없습니다.');
  var sh = ss.getSheetByName(want);
  if (!sh) {
    for (var i = 0; i < titles.length; i++) {
      if (titles[i].replace(/\s/g, '') === want.replace(/\s/g, '')) { sh = ss.getSheetByName(titles[i]); break; }
    }
  }
  if (!sh) throw new Error('시트 탭을 찾지 못했습니다: ' + want);
  return sh;
}

/** 헤더 이름으로 열을 찾는다. 반환: {headerRow, name, goal, total, rate, weeks:[{col,label,n}], renew} */
function layout_(sheet) {
  var width = Math.max(Math.min(sheet.getLastColumn() || 12, 40), 12);
  var head = sheet.getRange(1, 1, 5, width).getValues();
  var hr = -1, r, c;
  for (r = 0; r < head.length && hr < 0; r++) {
    for (c = 0; c < head[r].length; c++) {
      if (String(head[r][c]).replace(/\s/g, '') === '이름') { hr = r; break; }
    }
  }
  if (hr < 0) throw new Error('헤더 행(이름 칸)을 찾지 못했습니다.');
  var hdr = head[hr];
  var L = { headerRow: hr + 1, name: 0, goal: 0, total: 0, rate: 0, weeks: [], renew: 0 };
  for (c = 0; c < hdr.length; c++) {
    var t = String(hdr[c] || '').replace(/\s/g, '');
    if (!t) continue;
    if (t === '이름') { L.name = c + 1; continue; }
    if (/^\d+주$/.test(t)) { L.weeks.push({ col: c + 1, label: t, n: parseInt(t, 10) }); continue; }
    if (t.indexOf('연장') >= 0) { L.renew = c + 1; continue; }
    if (t.indexOf('달성률') >= 0) { L.rate = c + 1; continue; }
    if (t.indexOf('총') >= 0 && t.indexOf('목표') >= 0) { L.total = c + 1; continue; }
    if (t.indexOf('목표') >= 0 && !L.goal) { L.goal = c + 1; continue; }
  }
  L.weeks.sort(function (a, b) { return a.col - b.col; });
  if (!L.weeks.length) throw new Error('주차(1주·2주…) 열을 찾지 못했습니다.');
  if (!L.name) L.name = 1;
  if (!L.goal) L.goal = 2;
  if (!L.total) L.total = 3;
  if (!L.rate) L.rate = 4;
  if (!L.renew) L.renew = L.weeks[L.weeks.length - 1].col + 1;
  return L;
}

function col_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function rateFormula_(row, L) {
  var first = col_(L.weeks[0].col);
  var last = col_(L.weeks[L.weeks.length - 1].col);
  return '=IFERROR((COUNTIF(' + first + row + ':' + last + row + ', true) / ' + col_(L.total) + row + '),"-")';
}

/* =====================  읽기  ===================== */

function ping_() {
  var ss = ss_();
  return {
    app: 'silhaengban',
    spreadsheet: ss.getName(),
    spreadsheetId: ss.getId(),
    months: monthTitles_(),
    now: Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd HH:mm:ss')
  };
}

function monthData_(month) {
  var sheet = sheetByMonth_(month);
  var L = layout_(sheet);
  var title = sheet.getName().trim();
  var last = sheet.getLastRow();
  var members = [];

  if (last > L.headerRow) {
    var width = Math.max(L.renew, L.rate, L.total, L.weeks[L.weeks.length - 1].col, L.name);
    var values = sheet.getRange(L.headerRow + 1, 1, last - L.headerRow, width).getValues();
    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      var name = String(row[L.name - 1] || '').trim();
      if (!name) continue;
      var checks = [];
      var achieved = 0;
      for (var w = 0; w < L.weeks.length; w++) {
        var v = row[L.weeks[w].col - 1] === true;
        checks.push(v);
        if (v) achieved++;
      }
      var total = Number(row[L.total - 1]) || 0;
      var raw = row[L.rate - 1];
      var rate = (typeof raw === 'number' && !isNaN(raw)) ? raw : (total ? achieved / total : 0);
      members.push({
        row: L.headerRow + 1 + i,
        name: name,
        goal: String(row[L.goal - 1] || '').trim(),
        total: total,
        rate: rate,
        checks: checks,
        renew: row[L.renew - 1] === true
      });
    }
  }

  var period = '';
  if (L.headerRow > 1) period = String(sheet.getRange(L.headerRow - 1, L.weeks[0].col).getDisplayValue() || '').trim();
  var nextLabel = '';
  if (L.headerRow > 1) nextLabel = String(sheet.getRange(L.headerRow - 1, L.renew).getDisplayValue() || '').trim();

  return {
    spreadsheet: ss_().getName(),
    month: title,
    months: monthTitles_(),
    period: period,
    weeks: L.weeks.length,
    nextLabel: nextLabel || shortMonthLabel_(nextMonthTitle_(title)),
    members: members
  };
}

function findRow_(sheet, L, name) {
  var want = String(name || '').trim();
  if (!want) throw new Error('이름이 없습니다.');
  var last = sheet.getLastRow();
  if (last <= L.headerRow) throw new Error('참가자가 없습니다: ' + want);
  var names = sheet.getRange(L.headerRow + 1, L.name, last - L.headerRow, 1).getValues();
  for (var i = 0; i < names.length; i++) {
    if (String(names[i][0] || '').trim() === want) return L.headerRow + 1 + i;
  }
  throw new Error('해당 이름을 찾지 못했습니다: ' + want);
}

/* =====================  쓰기  ===================== */

function toggleCheck_(month, name, week) {
  var sheet = sheetByMonth_(month);
  var L = layout_(sheet);
  var idx = parseInt(week, 10);
  if (isNaN(idx) || idx < 1 || idx > L.weeks.length) throw new Error('주차 범위를 벗어났습니다: ' + week);
  var row = findRow_(sheet, L, name);
  var cell = sheet.getRange(row, L.weeks[idx - 1].col);
  var cur = cell.getValue() === true;
  cell.setValue(!cur);
  SpreadsheetApp.flush();
  return monthData_(sheet.getName());
}

function setRenew_(month, name, value) {
  var sheet = sheetByMonth_(month);
  var L = layout_(sheet);
  var row = findRow_(sheet, L, name);
  var on = (value === true || String(value).toLowerCase() === 'true' || String(value) === '1');
  sheet.getRange(row, L.renew).setValue(on);
  SpreadsheetApp.flush();
  return monthData_(sheet.getName());
}

function updateGoal_(month, name, goal, total) {
  var sheet = sheetByMonth_(month);
  var L = layout_(sheet);
  var row = findRow_(sheet, L, name);
  var g = String(goal == null ? '' : goal).trim();
  var t = parseInt(total, 10);
  sheet.getRange(row, L.goal).setValue(g);
  if (!isNaN(t) && t > 0) sheet.getRange(row, L.total).setValue(t);
  var rateCell = sheet.getRange(row, L.rate);
  if (!String(rateCell.getFormula() || '').trim()) rateCell.setFormula(rateFormula_(row, L));
  SpreadsheetApp.flush();
  return monthData_(sheet.getName());
}

function addMember_(month, name, goal, total) {
  var sheet = sheetByMonth_(month);
  var L = layout_(sheet);
  var want = String(name || '').trim();
  if (!want) throw new Error('이름이 없습니다.');
  var last = sheet.getLastRow();
  var exists = false;
  if (last > L.headerRow) {
    var names = sheet.getRange(L.headerRow + 1, L.name, last - L.headerRow, 1).getValues();
    for (var i = 0; i < names.length; i++) if (String(names[i][0] || '').trim() === want) { exists = true; break; }
  }
  if (exists) throw new Error('이미 있는 이름입니다: ' + want);

  var row = last + 1;
  var t = parseInt(total, 10);
  if (isNaN(t) || t <= 0) t = L.weeks.length;

  sheet.getRange(row, L.name).setValue(want);
  sheet.getRange(row, L.goal).setValue(String(goal || '').trim());
  sheet.getRange(row, L.total).setValue(t);
  sheet.getRange(row, L.rate).setFormula(rateFormula_(row, L));
  sheet.getRange(row, L.rate).setNumberFormat('0%');

  var rule = SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(true).build();
  var firstWeek = L.weeks[0].col, nWeeks = L.weeks.length;
  var weekRange = sheet.getRange(row, firstWeek, 1, nWeeks);
  weekRange.setDataValidation(rule);
  weekRange.setValue(false);
  var renewCell = sheet.getRange(row, L.renew);
  renewCell.setDataValidation(rule);
  renewCell.setValue(false);

  SpreadsheetApp.flush();
  return monthData_(sheet.getName());
}

/* =====================  다음 달 이월  ===================== */

function nextMonthTitle_(title) {
  var m = String(title || '').match(CONFIG.MONTH_PATTERN);
  if (!m) throw new Error('월 이름을 해석하지 못했습니다: ' + title);
  var y = parseInt(m[1], 10); var mo = parseInt(m[2], 10);
  y = (y < 100) ? 2000 + y : y;
  mo += 1;
  if (mo > 12) { mo = 1; y += 1; }
  var prefix = (String(m[1]).length === 2) ? ('0' + (y % 100)).slice(-2) : String(y);
  return prefix + '년 ' + mo + '월';
}

function shortMonthLabel_(title) {
  var m = String(title || '').match(CONFIG.MONTH_PATTERN);
  return m ? (parseInt(m[2], 10) + '월') : title;
}

function monthInfo_(title) {
  var m = String(title || '').match(CONFIG.MONTH_PATTERN);
  var y = parseInt(m[1], 10); if (y < 100) y += 2000;
  var mo = parseInt(m[2], 10);
  var last = new Date(y, mo, 0).getDate();
  var sundays = 0, lastSunday = last;
  for (var d = 1; d <= last; d++) if (new Date(y, mo - 1, d).getDay() === 0) sundays++;
  for (var d2 = last; d2 >= last - 6; d2--) if (new Date(y, mo - 1, d2).getDay() === 0) { lastSunday = d2; break; }
  return {
    year: y, month: mo, weeks: sundays || 4, lastSunday: lastSunday,
    period: '기간 (' + mo + '/1 ~ ' + mo + '/' + lastSunday + ')'
  };
}

function carryTotal_(total, weeks) {
  var t = parseInt(total, 10);
  if (!t || t <= 0) return weeks;
  return Math.min(t, weeks);
}

function rolloverPreview_(month) {
  var sheet = sheetByMonth_(month);
  var L = layout_(sheet);
  var title = sheet.getName().trim();
  var target = nextMonthTitle_(title);
  var info = monthInfo_(target);
  var data = monthData_(title);
  var carried = data.members.filter(function (m) { return m.renew; });
  var targetSheet = ss_().getSheetByName(target);
  return {
    month: title,
    targetTitle: target,
    exists: !!targetSheet,
    period: info.period,
    weeks: info.weeks,
    members: carried.map(function (m) { return { name: m.name, goal: m.goal, total: carryTotal_(m.total, info.weeks) }; })
  };
}

function rollover_(month, confirm) {
  if (String(confirm).toLowerCase() !== 'yes') throw new Error('확인 값(confirm=yes)이 필요합니다.');
  var ss = ss_();
  var source = sheetByMonth_(month);
  var srcTitle = source.getName().trim();
  var target = nextMonthTitle_(srcTitle);
  var info = monthInfo_(target);
  var data = monthData_(srcTitle);
  var carried = data.members.filter(function (m) { return m.renew; });

  var targetSheet = ss.getSheetByName(target);
  var created = false;
  if (!targetSheet) {
    targetSheet = ss.insertSheet(target, 0);
    writeMonthHeader_(targetSheet, target, info);
    created = true;
  } else {
    var L0 = targetSheet;
    var lastRow = L0.getLastRow();
    if (lastRow < 2) writeMonthHeader_(targetSheet, target, info);
  }

  var L = layout_(targetSheet);
  var last = targetSheet.getLastRow();
  var existing = {};
  if (last > L.headerRow) {
    var names = targetSheet.getRange(L.headerRow + 1, L.name, last - L.headerRow, 1).getValues();
    for (var i = 0; i < names.length; i++) existing[String(names[i][0] || '').trim()] = true;
  }

  var rule = SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(true).build();
  var added = [];
  var row = Math.max(last, L.headerRow) + 1;
  for (var k = 0; k < carried.length; k++) {
    var m = carried[k];
    if (existing[m.name]) continue;
    var total = carryTotal_(m.total, L.weeks.length);
    targetSheet.getRange(row, L.name).setValue(m.name);
    targetSheet.getRange(row, L.goal).setValue(m.goal || '');
    targetSheet.getRange(row, L.total).setValue(total);
    var rateCell = targetSheet.getRange(row, L.rate);
    rateCell.setFormula(rateFormula_(row, L));
    rateCell.setNumberFormat('0%');
    var weekRange = targetSheet.getRange(row, L.weeks[0].col, 1, L.weeks.length);
    weekRange.setDataValidation(rule).setValue(false);
    var renewCell = targetSheet.getRange(row, L.renew);
    renewCell.setDataValidation(rule).setValue(false);
    added.push(m.name);
    row++;
  }
  SpreadsheetApp.flush();

  var out = monthData_(target);
  out.created = created;
  out.added = added;
  out.from = srcTitle;
  return out;
}

function writeMonthHeader_(sheet, title, info) {
  var nWeeks = info.weeks;
  var firstWeekCol = 5;                     // E
  var renewCol = firstWeekCol + nWeeks;     // 주차 다음 칸
  sheet.getRange(2, 1, 1, renewCol).setValues([buildHeaderRow_(title, nWeeks)]);
  sheet.getRange(2, 1, 1, renewCol).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange(1, firstWeekCol).setValue(info.period);
  sheet.getRange(1, renewCol).setValue(shortMonthLabel_(nextMonthTitle_(title)));
  sheet.getRange(1, renewCol).setHorizontalAlignment('center');

  // 체크박스
  var rule = SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(true).build();
  sheet.getRange(3, firstWeekCol, 200, nWeeks).setDataValidation(rule);
  sheet.getRange(3, renewCol, 200, 1).setDataValidation(rule);
  sheet.getRange(3, 4, 200, 1).setNumberFormat('0%');

  sheet.setFrozenRows(2);
  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 320);
  sheet.setColumnWidth(3, 96);
  sheet.setColumnWidth(4, 76);
  for (var i = 0; i < nWeeks; i++) sheet.setColumnWidth(firstWeekCol + i, 44);
  sheet.setColumnWidth(renewCol, 78);
}

function buildHeaderRow_(title, nWeeks) {
  var mo = String(title).match(CONFIG.MONTH_PATTERN);
  var m = mo ? parseInt(mo[2], 10) : '';
  var row = ['이름', '달성 가능한 목표로 각자 설정', m + '월 총 목표', '달성률'];
  for (var i = 1; i <= nWeeks; i++) row.push(i + '주');
  row.push('연장여부');
  return row;
}
