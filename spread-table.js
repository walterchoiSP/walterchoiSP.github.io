'use strict';

// Browser and Node use the same parser; no upload or external dependencies.
function spreadTableIniToJson(source) {
  const sections = new Map();
  let fields = null;
  let previousKey = null;
  const fail = (line, message) => { throw new Error(`Line ${line}: ${message}`); };
  const lines = source.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || /^[';#]/.test(line)) return;
    const section = /^\[(Spread|SpreadTable[1-9]\d*)\]$/.exec(line);
    if (section) {
      const name = section[1];
      if (sections.has(name)) fail(index + 1, `Duplicate section ${name}.`);
      fields = {};
      sections.set(name, fields);
      previousKey = null;
      return;
    }
    if (!fields) fail(index + 1, 'Expected a spread-table section.');
    const separator = line.indexOf('=');
    if (separator < 0) {
      if (previousKey !== 'Name' || line.startsWith('[')) fail(index + 1, 'Expected Key=Value.');
      fields.Name += ' ' + line;
      return;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (Object.hasOwn(fields, key)) fail(index + 1, `Duplicate field ${key}.`);
    if (fields === sections.get('Spread')) {
      if (key !== 'TableCount') fail(index + 1, `Unexpected field ${key} in Spread.`);
    } else if (!/^(Name|Code|LevelCount|PriceFrom|(?:TickSize|PriceTo)[1-9]\d*)$/.test(key)) {
      fail(index + 1, `Unexpected spread-table field ${key}.`);
    }
    if (key === 'Name' || key === 'Code') {
      if (!value) fail(index + 1, `${key} cannot be empty.`);
      fields[key] = value;
    } else if (key === 'TableCount' || key === 'LevelCount') {
      const count = /^\d+$/.test(value) ? Number(value) : NaN;
      if (!Number.isSafeInteger(count) || count <= 0) fail(index + 1, `${key} must be a positive integer.`);
      fields[key] = count;
    } else {
      const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ? Number(value) : NaN;
      if (!Number.isFinite(number) || number < 0 || (key.startsWith('TickSize') && number === 0)) {
        fail(index + 1, `${key} must be a finite ${key.startsWith('TickSize') ? 'positive' : 'non-negative'} number.`);
      }
      fields[key] = number;
    }
    previousKey = key;
  });
  const count = sections.get('Spread')?.TableCount;
  if (!Number.isInteger(count)) throw new Error('Missing [Spread] TableCount.');
  if (sections.size !== count + 1) throw new Error('TableCount does not match the supplied sections.');
  const tables = [];
  const codes = new Set();
  for (let index = 1; index <= count; index++) {
    const table = sections.get(`SpreadTable${index}`);
    if (!table) throw new Error(`Missing [SpreadTable${index}].`);
    if (typeof table.Name !== 'string' || typeof table.Code !== 'string' ||
        !Number.isInteger(table.LevelCount) || !Number.isFinite(table.PriceFrom)) {
      throw new Error(`SpreadTable${index} is missing Name, Code, LevelCount or PriceFrom.`);
    }
    if (Object.keys(table).length !== 4 + table.LevelCount * 2) {
      throw new Error(`SpreadTable${index} fields do not match LevelCount.`);
    }
    const normalizedCode = /^\d$/.test(table.Code) ? table.Code.padStart(2, '0') : table.Code;
    if (codes.has(normalizedCode)) throw new Error('Spread-table codes must be unique.');
    codes.add(normalizedCode);
    let previousPriceTo = table.PriceFrom;
    for (let level = 1; level <= table.LevelCount; level++) {
      const tick = table[`TickSize${level}`];
      const priceTo = table[`PriceTo${level}`];
      if (!Number.isFinite(tick) || tick <= 0 || !Number.isFinite(priceTo) || priceTo < previousPriceTo) {
        throw new Error(`SpreadTable${index} contains an invalid or missing level ${level}.`);
      }
      previousPriceTo = priceTo;
    }
    tables.push(table);
  }
  return { TableCount: count, tables };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { spreadTableIniToJson };
}

if (typeof document !== 'undefined') {
  const input = document.getElementById('spread-file');
  const dropZone = document.getElementById('spread-drop-zone');
  const output = document.getElementById('spread-json');
  const status = document.getElementById('spread-status');
  const copyButton = document.getElementById('spread-copy');
  const downloadButton = document.getElementById('spread-download');
  let jsonText = '';
  let downloadName = 'spreadtable.json';
  let requestId = 0;
  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.classList.toggle('error', isError);
  };
  const clearOutput = () => {
    jsonText = '';
    output.value = '';
    copyButton.disabled = true;
    downloadButton.disabled = true;
  };
  const processFiles = async (files) => {
    const id = ++requestId;
    clearOutput();
    if (files.length !== 1 || !/\.ini$/i.test(files[0].name)) {
      setStatus('請選擇或拖放一個 .ini 檔案。', true);
      return;
    }
    const file = files[0];
    if (file.size > 2 * 1024 * 1024) {
      setStatus('檔案太大，請使用 2 MB 以下的 INI。', true);
      return;
    }
    setStatus('正在處理 ' + file.name + '…');
    try {
      const text = await file.text();
      if (id !== requestId) return;
      const json = spreadTableIniToJson(text);
      jsonText = JSON.stringify(json, null, 2);
      output.value = jsonText;
      downloadName = file.name.replace(/\.ini$/i, '.json');
      copyButton.disabled = false;
      downloadButton.disabled = false;
      setStatus(`已轉換 ${file.name}：${json.TableCount} 張表，Code 保留為字串。`);
    } catch (error) {
      if (id === requestId) setStatus('轉換失敗：' + error.message, true);
    }
  };
  input.addEventListener('change', () => {
    if (input.files.length) void processFiles(input.files);
    input.value = ''; // Allow selecting the same file again.
  });
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((name) => {
    dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      dropZone.classList.toggle('drag-over', name === 'dragenter' || name === 'dragover');
      if (name === 'drop') void processFiles(event.dataTransfer.files);
    });
  });
  // Prevent a file dropped outside the zone from navigating away.
  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('drop', (event) => event.preventDefault());
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(jsonText);
      setStatus('JSON 已複製。');
    } catch {
      output.focus();
      output.select();
      setStatus('無法自動複製，已選取 JSON；請按 Ctrl+C / Cmd+C。');
    }
  });
  downloadButton.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([jsonText], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = downloadName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
