const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('desktop/plugin.js', 'utf8')
const code = source.slice(source.indexOf('// v4 upload helpers'), source.indexOf('// end v4 upload helpers'))
const sandbox = { encodeURIComponent, Error, String, Uint8Array }; vm.createContext(sandbox); vm.runInContext(code + '\nthis.api = { collectEntries, prepareBatch, uploadBatch }', sandbox)
const { collectEntries, prepareBatch, uploadBatch } = sandbox.api
const file = (name, size = 1) => ({ name, size, type: 'text/plain', arrayBuffer: async () => new Uint8Array([1]).buffer })
const entry = (name, f) => ({ name, isFile: true, file: ok => ok(f) })
const dir = (name, entries) => ({ name, isDirectory: true, createReader: () => { let n = 0; return { readEntries: ok => ok(n++ === 0 ? entries : []) } } })
test('folder traversal, junk and limits', async () => {
  const items = await collectEntries([dir('folder', [entry('a.txt', file('a.txt')), dir('.git', [entry('x', file('x'))]), entry('.DS_Store', file('.DS_Store'))])])
  const batch = prepareBatch(items)
  assert.equal(batch.items.length, 1); assert.equal(batch.items[0].path, 'folder/a.txt'); assert.equal(batch.junk, 2)
  assert.throws(() => prepareBatch(Array.from({ length: 1001 }, () => ({ file: file('x'), path: 'x' }))), /1000/)
  assert.throws(() => prepareBatch([{ file: file('x', 501 * 1024 * 1024), path: 'x' }]), /500/)
})
test('uploads sequentially, cancel and retry failures', async () => {
  const calls = []; let cancel = false; let fail = true
  const ctx = { rest: async (url) => { calls.push(url); if (fail) { fail = false; throw Error('bad') } cancel = true; return { status: 'created' } } }
  const items = ['a', 'b', 'c'].map(x => ({ path: 'folder/' + x, file: file(x), status: 'pending' }))
  await uploadBatch(ctx, 'p', items, 'overwrite', () => cancel, () => {})
  assert.equal(items[0].status, 'failed'); assert.equal(items[1].status, 'created'); assert.equal(items[2].status, 'pending')
  assert.match(calls[0], /path=folder%2Fa/); assert.match(calls[0], /on_conflict=overwrite/)
  cancel = false; await uploadBatch(ctx, 'p', items.filter(i => i.status === 'failed'), 'skip', () => cancel, () => {})
  assert.equal(items[0].status, 'created'); assert.match(calls[2], /on_conflict=skip/)
})
