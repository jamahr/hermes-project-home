const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync('desktop/plugin.js', 'utf8').replace(/^import .*$/gm, '').replace('export default {', 'const plugin = {')
const noop = () => {}
const jsx = (type, props) => typeof type === 'function' ? type(props || {}) : ({ type, props })
const sdk = ['DropdownMenu','DropdownMenuContent','DropdownMenuItem','DropdownMenuSeparator','DropdownMenuTrigger','Button','Input','Textarea','Dialog','DialogContent','DialogHeader','DialogTitle','Codicon','EmptyState'].reduce((a,k) => (a[k] = k, a), {})
const ctx = { rest: async () => ({}) }
const pins = { has: () => false, get: () => ({}), subscribe: noop }
const project = { id: 'p', name: 'Project', primary_path: '/tmp/project' }
const sandbox = { ...sdk, jsx, jsxs: jsx, useState: v => [typeof v === 'function' ? v() : v, noop], useEffect: noop, useRef: v => ({ current:v }), useQuery: () => ({data: {}, refetch: noop}), useQueryClient: () => ({invalidateQueries: noop}), useValue: () => '', gatewayActivationEpoch: () => 0, useGatewayActivationEpoch: () => 0, host: {state: {profile:{get:()=>''}}, request: noop}, window: {location:{hash:''}}, URLSearchParams, encodeURIComponent, Map, Set, Date, Error, String, Math, Object, Array }
vm.createContext(sandbox)
vm.runInContext(source + '\nthis.components = { CreateProject, Rename, FileEditor, ContextAdd, ContextView, CronAdd, ComposerProjectPicker, Hub, Project, Modal }', sandbox)
for (const [name, Component] of Object.entries(sandbox.components)) {
  test(`${name} renders without throwing`, () => {
    assert.doesNotThrow(() => Component({ ctx, project: name === 'Rename' || name === 'Project' ? project : 'p', projects: [project], pins, changePin: noop, close: noop, done: noop, created: noop, name: 'test.txt', title: 'Archive project?' }))
  })
}
