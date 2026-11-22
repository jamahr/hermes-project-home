// v0.6: archived-projects view and composer picker assignment. Mocked host, no network.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('desktop/plugin.js', 'utf8').replace(/^import .*$/gm, '').replace('export default {', 'const plugin = {')
const noop = () => {}
const jsx = (type, props) => typeof type === 'function' ? type(props || {}) : ({ type, props })
const sdkNames = ['Tip','SegmentedControl','ConfirmDialog','CopyButton','DropdownMenu','DropdownMenuContent','DropdownMenuItem','DropdownMenuSeparator','DropdownMenuTrigger','Button','Input','Textarea','Dialog','DialogContent','DialogHeader','DialogTitle','Codicon','EmptyState']
const atom = v => ({ value: v, get() { return this.value }, set(x) { this.value = x }, listen: () => noop })

function makeSandbox({ focused = null, moveError = null, draft = null, landedCwd } = {}) {
  const calls = [], notes = [], drafts = []
  const state = { focusedStoredSessionId: atom(focused), profile: atom('default'), cwd: atom(''), connectionId: atom('c') }
  const host = {
    state,
    async request(method, params) {
      calls.push([method, params])
      if (method === 'session.workspace.move') {
        if (moveError) throw new Error(moveError)
        state.cwd.set(landedCwd ?? params.cwd)
        return { cwd: landedCwd ?? params.cwd }
      }
      if (method === 'session.create') return { stored_session_id: 'new-1', session_id: 'rt-1' }
      return {}
    },
    async openSession(id) { calls.push(['openSession', id]); state.focusedStoredSessionId.set(id) },
    navigate: path => calls.push(['navigate', path]),
    notify: n => notes.push(n),
    composer: { getDraft: async () => draft, setDraft: async (id, text) => { drafts.push([id, text]); return true } }
  }
  const sdk = Object.fromEntries(sdkNames.map(n => [n, props => ({ type: n, props })]))
  const sandbox = { ...sdk, jsx, jsxs: jsx, host, useState: v => [typeof v === 'function' ? v() : v, noop], useEffect: noop, useRef: v => ({ current: v }), useQuery: () => ({ data: {}, refetch: noop }), useQueryClient: () => ({ invalidateQueries: async () => {} }), useValue: a => a?.get?.(), gatewayActivationEpoch: () => 1, useGatewayActivationEpoch: () => 1, window: { location: { hash: '' }, addEventListener: noop, removeEventListener: noop }, setTimeout, clearTimeout, URLSearchParams, Promise, Date }
  vm.createContext(sandbox)
  vm.runInContext(source + '\nthis.api = { assignProject, openProjectChat, Hub, ArchivedList, Project, setArchived }', sandbox)
  return { api: sandbox.api, calls, notes, drafts, host }
}
const plain = v => JSON.parse(JSON.stringify(v))
const P = { id: 'p_1', name: 'Alpha', primary_path: '/root/projects/alpha' }
const flatten = node => node == null || node === false ? '' : Array.isArray(node) ? node.map(flatten).join(' ') : typeof node !== 'object' ? String(node) : [node.props?.label, node.props?.title, node.props?.description, flatten(node.props?.children), flatten(node.props?.options?.map(o => o.label))].filter(Boolean).join(' ')
const find = (node, pred, out = []) => { if (!node || typeof node !== 'object') return out; if (Array.isArray(node)) { node.forEach(n => find(n, pred, out)); return out } if (pred(node)) out.push(node); find(node.props?.children, pred, out); return out }

test('a focused draft that is not saved yet is moved in place, never duplicated (the 2026-11-20 bug)', async () => {
  const { api, calls } = makeSandbox({ focused: '20261120_085602_cad9e5' })
  const result = await api.assignProject(P)
  assert.equal(result.created, false)
  assert.deepEqual(calls.map(c => c[0]), ['session.workspace.move'])
  assert.deepEqual(plain(calls[0][1]), { session_key: '20261120_085602_cad9e5', cwd: P.primary_path, profile: 'default' })
  assert.ok(!calls.some(c => c[0] === 'session.create'), 'must not create a second chat')
  assert.ok(!calls.some(c => c[0] === 'session.list'), 'must not gate on the saved-session list')
})

test('no session at all: creates one in the project, opens it, re-pins the folder and carries the draft text', async () => {
  const { api, calls, drafts } = makeSandbox({ focused: null, draft: 'half-written task' })
  const result = await api.assignProject(P)
  assert.equal(result.created, true)
  assert.deepEqual(calls.map(c => c[0]), ['session.create', 'openSession', 'session.workspace.move'])
  assert.equal(calls[0][1].cwd, P.primary_path)
  assert.equal(calls[2][1].session_key, 'new-1')
  assert.deepEqual(drafts, [['new-1', 'half-written task']])
})

test('a stale focused id the backend no longer knows falls back to a fresh project chat', async () => {
  const { api, calls } = makeSandbox({ focused: 'gone', moveError: 'session not found' })
  const result = await api.assignProject(P)
  assert.equal(result.created, true)
  assert.ok(calls.some(c => c[0] === 'session.create'))
})

test('other move failures surface instead of silently creating a chat', async () => {
  const { api, calls } = makeSandbox({ focused: 'busy', moveError: 'session busy' })
  await assert.rejects(api.assignProject(P), /busy/)
  assert.ok(!calls.some(c => c[0] === 'session.create'))
})

test('a move that lands outside the project is reported as a failure', async () => {
  const { api } = makeSandbox({ focused: 'k', landedCwd: '/root' })
  await assert.rejects(api.assignProject(P), /landed in \/root/)
})

test('hub offers Active and Archived tabs with counts', () => {
  const { api } = makeSandbox()
  const tree = api.Hub({ ctx: {}, projects: [P], archived: [{ ...P, id: 'p_2', name: 'Old', archived: true }], view: 'active', pins: { has: () => false, get: () => ({}) }, changePin: noop })
  const seg = find(tree, n => n.type === 'SegmentedControl')[0]
  assert.deepEqual(plain(seg.props.options.map(o => o.label)), ['Active (1)', 'Archived (1)'])
})

test('archived tab lists archived projects (row opens, Restore un-archives)', async () => {
  const { api, calls } = makeSandbox()
  const old = { ...P, id: 'p_2', name: 'Old project', archived: true, description: 'wrapped up' }
  const tree = api.ArchivedList({ projects: [old], search: '' })
  const text = flatten(tree)
  assert.match(text, /Old project/)
  assert.match(text, /wrapped up/)
  const restore = find(tree, n => n.type === 'Button' && n.props['aria-label'] === 'Restore Old project')[0]
  assert.ok(restore, 'Restore button')
  assert.ok(find(tree, n => n.type === 'button' && n.props['aria-label'] === 'Open Old project').length, 'row opens the project')
  await restore.props.onClick()
  await new Promise(r => setTimeout(r, 0))
  assert.deepEqual(plain(calls.find(c => c[0] === 'projects.archive')), ['projects.archive', { id: 'p_2', restore: true }])
})

test('archived tab empty state explains where archived projects come from', () => {
  const { api } = makeSandbox()
  assert.match(flatten(api.ArchivedList({ projects: [], search: '' })), /No archived projects/)
})

test('archived project page shows a banner and Restore instead of Archive', () => {
  const { api } = makeSandbox()
  const page = api.Project({ ctx: { rest: async () => ({}) }, project: { ...P, archived: true }, projects: [], pins: { has: () => false, get: () => ({}) }, changePin: noop })
  const text = flatten(page)
  assert.match(text, /This project is archived/)
  assert.match(text, /Restore project/)
  assert.doesNotMatch(text, /Archive…/)
})

test('board load retries instead of leaving every card in To Do', async () => {
  let boardCalls = 0
  const timers = []
  const sdk = Object.fromEntries(sdkNames.map(n => [n, props => ({ type: n, props })]))
  const state = { focusedStoredSessionId: atom(null), profile: atom('default'), cwd: atom(''), connectionId: atom('c') }
  const host = { state, request: async () => ({ projects: [{ id: 'p_1', name: 'A' }] }), notify: noop, navigate: noop }
  const sandbox = { ...sdk, COMPOSER_AREAS: { leading: 'l' }, ROUTES_AREA: 'r', SIDEBAR_NAV_AREA: 's', PALETTE_AREA: 'p', jsx, jsxs: jsx, host, useState: v => [v, noop], useEffect: noop, useRef: v => ({ current: v }), useQuery: () => ({}), useQueryClient: () => ({}), useValue: noop, gatewayActivationEpoch: () => 1, useGatewayActivationEpoch: () => 1, window: { location: { hash: '' }, addEventListener: noop, removeEventListener: noop }, setTimeout: (fn, ms) => { timers.push(fn); return timers.length }, clearTimeout: noop, setInterval: () => 0, clearInterval: noop, URLSearchParams, Promise, Date }
  vm.createContext(sandbox)
  vm.runInContext(source + '\nthis.plugin = plugin', sandbox)
  const ctx = { register: () => noop, onDispose: noop, storage: { get: () => [], remove: noop }, rest: async () => { boardCalls++; if (boardCalls < 3) throw new Error('gateway not ready'); return { projects: { p_1: { status: 'Backlog' } } } } }
  sandbox.plugin.register(ctx)
  for (let i = 0; i < 5 && boardCalls < 3; i++) { await new Promise(r => setImmediate(r)); const fn = timers.shift(); if (fn) fn() }
  await new Promise(r => setImmediate(r))
  assert.equal(boardCalls, 3)
})
