/* Code.gs 검증용 최소 가짜 서비스 (SpreadsheetApp / ContentService / Utilities / PropertiesService)
   브라우저에서 dev/test.html 로 실행합니다. 실제 시트는 건드리지 않습니다. */
(function () {
  'use strict';

  var MIME = { JSON: 'application/json', JAVASCRIPT: 'application/javascript' };

  function key(r, c) { return r + ',' + c; }

  function MockRange(sheet, row, col, nRows, nCols) {
    this.sheet = sheet; this.row = row; this.col = col;
    this.nRows = nRows || 1; this.nCols = nCols || 1;
  }
  MockRange.prototype.getValues = function () {
    var out = [];
    for (var r = 0; r < this.nRows; r++) {
      var line = [];
      for (var c = 0; c < this.nCols; c++) {
        line.push(this.sheet.valueAt(this.row + r, this.col + c));
      }
      out.push(line);
    }
    return out;
  };
  MockRange.prototype.setValues = function (vals) {
    for (var r = 0; r < vals.length; r++) {
      for (var c = 0; c < vals[r].length; c++) {
        this.sheet.setAt(this.row + r, this.col + c, vals[r][c]);
      }
    }
    return this;
  };
  MockRange.prototype.getValue = function () { return this.sheet.valueAt(this.row, this.col); };
  MockRange.prototype.getDisplayValue = function () {
    var v = this.sheet.valueAt(this.row, this.col);
    return v === null || v === undefined ? '' : String(v);
  };
  MockRange.prototype.setValue = function (v) { this.sheet.setAt(this.row, this.col, v); return this; };
  MockRange.prototype.getFormula = function () { return this.sheet.formulaAt(this.row, this.col); };
  MockRange.prototype.setFormula = function (f) { this.sheet.setFormulaAt(this.row, this.col, f); return this; };
  MockRange.prototype.setNumberFormat = function () { return this; };
  MockRange.prototype.setDataValidation = function () { return this; };
  MockRange.prototype.setFontWeight = function () { return this; };
  MockRange.prototype.setHorizontalAlignment = function () { return this; };
  MockRange.prototype.setBackground = function () { return this; };

  function MockSheet(name) {
    this.name = name;
    this.cells = {};     // "r,c" -> value or {f: formula}
    this.frozen = 0;
  }
  MockSheet.prototype.getName = function () { return this.name; };
  MockSheet.prototype.setName = function (n) { this.name = n; };
  MockSheet.prototype.setAt = function (r, c, v) { this.cells[key(r, c)] = { v: v }; };
  MockSheet.prototype.setFormulaAt = function (r, c, f) { this.cells[key(r, c)] = { f: f, v: 0 }; };
  MockSheet.prototype.raw = function (r, c) { return this.cells[key(r, c)]; };
  MockSheet.prototype.formulaAt = function (r, c) {
    var cell = this.cells[key(r, c)];
    return cell && cell.f ? cell.f : '';
  };
  MockSheet.prototype.valueAt = function (r, c) {
    var cell = this.cells[key(r, c)];
    if (!cell) return '';
    if (cell.f) return this.evalFormula(cell.f);
    return cell.v === undefined ? '' : cell.v;
  };
  /* 지원 수식: =IFERROR((COUNTIF(E3:I3, true) / C3),"-") */
  MockSheet.prototype.evalFormula = function (f) {
    var m = String(f).match(/^=IFERROR\(\(COUNTIF\(([A-Z]+)(\d+):([A-Z]+)(\d+),\s*true\)\s*\/\s*([A-Z]+)(\d+)\),"-"\)$/);
    if (!m) return '#UNSUPPORTED';
    var r1 = parseInt(m[2], 10), r2 = parseInt(m[4], 10);
    var c1 = colIndex(m[1]), c2 = colIndex(m[3]);
    var count = 0;
    for (var r = r1; r <= r2; r++) {
      for (var c = c1; c <= c2; c++) if (this.valueAt(r, c) === true) count++;
    }
    var total = Number(this.valueAt(parseInt(m[6], 10), colIndex(m[5])));
    if (!total) return '-';
    return count / total;
  };
  MockSheet.prototype.getLastRow = function () {
    var max = 0, k, p;
    for (k in this.cells) {
      var cell = this.cells[k];
      if (!cell) continue;
      var has = (cell.f !== undefined) || (cell.v !== '' && cell.v !== null && cell.v !== undefined);
      if (!has) continue;
      p = k.split(',');
      if (parseInt(p[0], 10) > max) max = parseInt(p[0], 10);
    }
    return max;
  };
  MockSheet.prototype.getLastColumn = function () {
    var max = 0, k, p;
    for (k in this.cells) {
      var cell = this.cells[k];
      if (!cell) continue;
      var has = (cell.f !== undefined) || (cell.v !== '' && cell.v !== null && cell.v !== undefined);
      if (!has) continue;
      p = k.split(',');
      if (parseInt(p[1], 10) > max) max = parseInt(p[1], 10);
    }
    return max;
  };
  MockSheet.prototype.getRange = function (row, col, nRows, nCols) {
    return new MockRange(this, row, col, nRows || 1, nCols || 1);
  };
  MockSheet.prototype.setFrozenRows = function (n) { this.frozen = n; };
  MockSheet.prototype.setColumnWidth = function () { };
  MockSheet.prototype.setRowHeight = function () { };

  function colIndex(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n;
  }

  function MockSpreadsheet(id, name) {
    this.id = id; this.name = name; this.sheets = [];
  }
  MockSpreadsheet.prototype.getId = function () { return this.id; };
  MockSpreadsheet.prototype.getName = function () { return this.name; };
  MockSpreadsheet.prototype.getSheets = function () { return this.sheets.slice(); };
  MockSpreadsheet.prototype.getSheetByName = function (n) {
    for (var i = 0; i < this.sheets.length; i++) if (this.sheets[i].name === n) return this.sheets[i];
    return null;
  };
  MockSpreadsheet.prototype.insertSheet = function (name, index) {
    var s = new MockSheet(name);
    if (typeof index === 'number') this.sheets.splice(index, 0, s);
    else this.sheets.push(s);
    return s;
  };
  MockSpreadsheet.prototype.addSheet = function (name) {
    var s = new MockSheet(name);
    this.sheets.push(s);
    return s;
  };

  var active = null;

  window.SpreadsheetApp = {
    getActiveSpreadsheet: function () { return active; },
    openById: function () { return active; },
    flush: function () { },
    newDataValidation: function () {
      var rule = { checkbox: true };
      var builder = {
        requireCheckbox: function () { return builder; },
        setAllowInvalid: function () { return builder; },
        build: function () { return rule; }
      };
      return builder;
    }
  };

  window.ContentService = {
    MimeType: MIME,
    createTextOutput: function (text) {
      var out = {
        _text: text, _mime: 'text/plain',
        setMimeType: function (m) { out._mime = m; return out; },
        getContent: function () { return out._text; },
        getMimeType: function () { return out._mime; }
      };
      return out;
    }
  };

  window.Utilities = {
    formatDate: function (d) { return d.toISOString().replace('T', ' ').slice(0, 19); }
  };

  window.PropertiesService = {
    getScriptProperties: function () {
      return { getProperty: function () { return null; }, setProperty: function () { } };
    }
  };

  window.__MOCK__ = {
    create: function (id, name) { active = new MockSpreadsheet(id, name); return active; },
    colIndex: colIndex,
    active: function () { return active; }
  };
})();
