'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spreadTableIniToJson: parse } = require('../spread-table.js');
const small = `[Spread]
TableCount=1
[SpreadTable1]
Name=Example
Code=01
LevelCount=2
PriceFrom=0.01
TickSize1=0.001
PriceTo1=0.25
TickSize2=0.005
PriceTo2=10
`;

test('actual INI: five tables, numbered fields, leading zero and multiline name', () => {
  const json = parse(fs.readFileSync(path.join(__dirname, 'fixtures/spreadtable.ini'), 'utf8'));
  assert.equal(json.TableCount, 5);
  assert.deepEqual(json.tables.map(t => t.Code), ['01', '03', '04', '05', '06']);
  assert.deepEqual(json.tables.map(t => t.LevelCount), [11, 1, 11, 10, 11]);
  assert.equal(json.tables[0].TickSize9, 1);
  assert.equal(json.tables[4].Name, 'New Code (apply to Structured Products (including CBBC and DW))');
  assert.equal(json.tables[3].TickSize10, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(json)), json);
});
test('BOM, CRLF, comments and field whitespace', () => {
  assert.deepEqual(parse('\uFEFF; comment\r\n# comment\r\n\' remark\r\n' +
    small.replace(/\n/g, '\r\n').replace('Code=01', ' Code = 01 ')), parse(small));
});
test('sections sorted by number rather than file position', () => {
  assert.deepEqual(parse(small.slice(small.indexOf('[SpreadTable1]')) + '\n[Spread]\nTableCount=1'), parse(small));
});
test('reject incomplete, duplicate and invalid fields', () => {
  for (const source of [
    '', small.replace('TableCount=1', 'TableCount=2'),
    small.replace('LevelCount=2', 'LevelCount=3'), small.replace('PriceTo2=10', ''),
    small.replace('TickSize2=0.005', 'TickSize2=0'),
    small.replace('PriceTo2=10', 'PriceTo2=0.1'), small.replace('Code=01', 'Code='),
    small.replace('PriceFrom=0.01', 'PriceFrom=NaN'),
    small.replace('TableCount=1', 'TableCount=1.5'),
    small + '\nTickSize3=1\nPriceTo3=20', small + '\nCode=02',
    small + '\n[SpreadTable1]', small.replace('[SpreadTable1]', '[Unknown]'),
    small + '\nmalformed line', small + '\n__proto__=oops',
    small.replace('PriceFrom=0.01', 'PriceFrom=0x01'),
  ]) assert.throws(() => parse(source), Error, source);
  assert.throws(() => parse(small.replace('TableCount=1', 'TableCount=2') +
    small.slice(small.indexOf('[SpreadTable1]')).replace('[SpreadTable1]', '[SpreadTable2]')), /unique/);
});

function ui() {
  const elements = new Map();
  function element() {
    const handlers = {};
    const classes = new Set();
    return {
      value: '', disabled: true, files: [], textContent: '',
      classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); }, contains(name) { return classes.has(name); } },
      addEventListener(name, handler) { handlers[name] = handler; },
      async emit(name, extra = {}) { await handlers[name]?.({ preventDefault() {}, ...extra }); await new Promise(setImmediate); },
      focus() { this.focused = true; }, select() { this.selected = true; },
    };
  }
  for (const id of ['spread-file', 'spread-drop-zone', 'spread-json', 'spread-status', 'spread-copy', 'spread-download']) elements.set(id, element());
  const downloads = [], copied = [];
  const document = {
    getElementById(id) { return elements.get(id); },
    addEventListener() {},
    createElement() { return { click() { downloads.push(this.download); } }; },
  };
  const context = {
    document, navigator: { clipboard: { async writeText(text) { copied.push(text); } } },
    URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
    Blob, setTimeout(fn) { fn(); },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../spread-table.js'), 'utf8'), context);
  return { get: id => elements.get('spread-' + id), downloads, copied, context };
}
const file = (name = 'example.ini', text = small, size = text.length) => ({ name, size, async text() { return text; } });
test('select file renders JSON, enables copy/download and same-file reselection', async () => {
  const u = ui();
  u.get('file').files = [file()];
  await u.get('file').emit('change');
  assert.deepEqual(JSON.parse(u.get('json').value), parse(small));
  assert.equal(u.get('file').value, '');
  assert.equal(u.get('copy').disabled, false);
  await u.get('copy').emit('click');
  assert.equal(u.copied[0], u.get('json').value);
  await u.get('download').emit('click');
  assert.deepEqual(u.downloads, ['example.json']);
});
test('drop supports INI; invalid extension, multiple files, size or malformed input clears output', async () => {
  const u = ui();
  for (const files of [[file('EXAMPLE.INI')], [file('bad.txt')], [file(), file()], [file('huge.ini', '', 2097153)], [file('bad.ini', 'broken')]]) {
    await u.get('drop-zone').emit('drop', { dataTransfer: { files } });
    const valid = files[0].name === 'EXAMPLE.INI';
    assert.equal(u.get('copy').disabled, !valid);
    assert.equal(u.get('status').classList.contains('error'), !valid);
    if (!valid) assert.equal(u.get('json').value, '');
  }
});
test('clipboard failure selects output for manual copying', async () => {
  const u = ui();
  u.get('file').files = [file()];
  await u.get('file').emit('change');
  u.context.navigator.clipboard.writeText = async () => { throw new Error('blocked'); };
  await u.get('copy').emit('click');
  assert.equal(u.get('json').selected, true);
});
test('a stale file read cannot overwrite a later selection', async () => {
  const u = ui();
  let release;
  const delayed = { name: 'slow.ini', size: 100, text: () => new Promise(resolve => { release = resolve; }) };
  u.get('file').files = [delayed];
  await u.get('file').emit('change');
  u.get('file').files = [file('new.ini', small.replace('Name=Example', 'Name=Newest'))];
  await u.get('file').emit('change');
  release(small);
  await new Promise(setImmediate);
  assert.equal(JSON.parse(u.get('json').value).tables[0].Name, 'Newest');
});
