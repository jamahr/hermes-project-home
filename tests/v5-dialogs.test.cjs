const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('desktop/plugin.js', 'utf8').replace(/^import .*$/gm, '').replace('export default {', 'const plugin = {')
const noop = () => {}
const jsx = (type, props) => typeof type === 'function' ? type(props || {}) : ({ type, props })
const sdk = ['Tip','SegmentedControl','ConfirmDialog','CopyButton','DropdownMenu','DropdownMenuContent','DropdownMenuItem','DropdownMenuSeparator','DropdownMenuTrigger','Button','Input','Textarea','Dialog','DialogContent','DialogHeader','DialogTitle','Codicon','EmptyState'].reduce((a,k) => (a[k] = k, a), {})
const ctx = { rest: async () => ({}) }
const pins = { has: () => false, get: () => ({}), subscribe: noop }
const project = { id: 'p', name: 'Project', primary_path: '/tmp/project' }
const sandbox = { ...sdk, jsx, jsxs: jsx, useState: v => [typeof v === 'function' ? v() : v, noop], useEffect: noop, useRef: v => ({ current:v }), useQuery: () => ({data: {}, refetch: noop}), useQueryClient: () => ({invalidateQueries: noop}), useValue: () => '', gatewayActivationEpoch: () => 0, useGatewayActivationEpoch: () => 0, host: {state: {profile:{get:()=>''}}, request: noop}, window: {location:{hash:''}}, URLSearchParams, encodeURIComponent, Map, Set, Date, Error, String, Math, Object, Array }
vm.createContext(sandbox)
vm.runInContext(source + '\nthis.components = { CreateProject, Rename, FileEditor, ContextAdd, ContextView, CronAdd, ComposerProjectPicker, Hub, Project, Modal, ScheduledRow }', sandbox)
for (const [name, Component] of Object.entries(sandbox.components)) {
  test(`${name} renders without throwing`, () => {
    assert.doesNotThrow(() => Component({ ctx, project: name === 'Rename' || name === 'Project' ? project : 'p', projects: [project], pins, changePin: noop, close: noop, done: noop, created: noop, job: {job_id:'j'}, action: noop, remove: noop, name: 'test.txt', title: 'Archive project?' }))
  })
}

test('v5 uses SDK segmented controls and confirmation', () => { assert.match(source, /SegmentedControl/); assert.match(source, /ConfirmDialog/); assert.doesNotMatch(source, /window\.confirm/) })

function flatten(node) {
  if (node == null || node === false) return ''
  if (Array.isArray(node)) return node.map(flatten).join(' ')
  if (typeof node !== 'object') return String(node)
  return flatten(node.props?.children)
}
test('upload dialog renders folder and oversized skipped file', () => {
  let index = 0
  sandbox.useState = v => { const i = index++; return [i === 2 ? [{path:'docs/small.txt', file:{size:12}, status:'pending'}, {path:'docs/large.bin', file:{size:11000000}, status:'skipped', reason:'Exceeds 10 MiB'}] : (typeof v === 'function' ? v() : v), noop] }
  const text = flatten(sandbox.components.ContextAdd({ctx, project:'p', close:noop, done:noop}))
  assert.match(text, /docs · 2 files/); assert.match(text, /large.bin/); assert.match(text, /Too large/)
})
test('note tab renders editor', () => {
  let index = 0
  sandbox.useState = v => [index++ === 8 ? 'note' : (typeof v === 'function' ? v() : v), noop]
  assert.match(flatten(sandbox.components.ContextAdd({ctx, project:'p', close:noop, done:noop})), /Add note/)
})
test('text and binary viewers render appropriately', () => {
  sandbox.useState = v => [typeof v === 'function' ? v() : v, noop]
  sandbox.useQuery = () => ({data:{content:'hello'}, refetch:noop})
  assert.match(flatten(sandbox.components.ContextView({ctx, project:'p', name:'a.txt', file:{text:true}, close:noop})), /hello/)
  const binary = flatten(sandbox.components.ContextView({ctx, project:'p', name:'docs/a.pdf', file:{text:false,size:2048,mtime:1}, close:noop}))
  assert.match(binary, /Preview isn't available/); assert.match(binary, /context\/docs\/a.pdf/); assert.match(binary, /2.0 KB/)
})
test('scheduled row and confirm dialog render', () => {
  const row = sandbox.components.ScheduledRow({job:{name:'Job',schedule_display:'Daily',enabled:false},action:noop,remove:noop})
  assert.match(flatten(row), /Daily/); assert.match(flatten(row), /Paused/); assert.match(flatten(row), /Resume/)
  let i=0; sandbox.useState = v => [i++ === 8 ? {job_id:'j',name:'Job'} : (typeof v === 'function' ? v() : v), noop]
  const page = sandbox.components.Project({ctx,project,projects:[project],pins,changePin:noop})
  assert.match(JSON.stringify(page), /ConfirmDialog/)
  sandbox.useState = v => [typeof v === 'function' ? v() : v, noop]
})
test('empty states describe context and memory', () => {
  sandbox.useQuery = () => ({data:{},refetch:noop})
  const page = flatten(sandbox.components.Project({ctx,project,projects:[project],pins,changePin:noop}))
  assert.match(page, /Files the agent should know about/); assert.match(page, /Facts the agent records about this project/)
})

test('cron dialog labels and presets are visible', () => { const text = flatten(sandbox.components.CronAdd({ctx,project:'p',close:noop,done:noop})); assert.match(text, /What should the agent do\?/); assert.match(text, /Every weekday 9am/); assert.match(text, /When/); })

test('expired one-shot tasks cannot resume', () => {
  const text = flatten(sandbox.components.ScheduledRow({job:{name:'Old',schedule:{kind:'once',run_at:'2020-01-01T09:00:00Z'},enabled:false},action:noop,remove:noop}))
  assert.match(text, /Expired/); assert.match(text, /Remove/); assert.doesNotMatch(text, /Resume/)
})
test('upload dialog has destination, accessible remove and neutral footer', () => {
  let index = 0
  sandbox.useState = v => { const i = index++; return [i === 2 ? [{path:'docs/small.txt',file:{size:12},status:'pending'}] : (typeof v === 'function' ? v() : v), noop] }
  const view = sandbox.components.ContextAdd({ctx,project:'p',close:noop,done:noop})
  const text = flatten(view), tree = JSON.stringify(view)
  assert.match(text, /Will be added to context\/docs\//); assert.match(text, /Clear all/); assert.match(text, /folders keep their structure/); assert.match(tree, /Remove docs\/small.txt/); assert.match(tree, /--ui-stroke-secondary/); assert.doesNotMatch(tree, /sticky bottom-0/)
  sandbox.useState = v => [typeof v === 'function' ? v() : v, noop]
})
