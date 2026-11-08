import { host, ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA, Button, Input, Textarea, Dialog, DialogContent, DialogHeader, DialogTitle, Codicon, EmptyState, useQuery, useQueryClient, useValue, gatewayActivationEpoch, useGatewayActivationEpoch } from '@hermes/plugin-sdk'
import { useState, useEffect } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const BASE = '/projects-home'
const muted = 'text-(--ui-text-tertiary)'
const border = 'border-(--ui-stroke-secondary)'
const enc = encodeURIComponent
const STATUSES = ['Backlog', 'To Do', 'In Progress', 'Done']
const conversational = s => !['tool', 'cron', 'kanban', 'subagent'].includes((s.source || '').toLowerCase()) && !s.archived && !s.parent_session_id
const sessionRows = data => [...new Map((data?.project?.repos || []).flatMap(r => (r.groups || []).flatMap(g => g.sessions || [])).map(s => [s._lineage_root_id || s.id, s])).values()]
const go = id => host.navigate(id ? `${BASE}?project=${enc(id)}` : BASE)
const query = (project, name) => `?project=${enc(project)}${name ? `&name=${enc(name)}` : ''}`
const fail = e => e instanceof Error ? e.message : String(e)
const button = (label, onClick, props = {}) => jsx(Button, { type: 'button', variant: 'ghost', onClick, ...props, children: label })
const icon = name => jsx(Codicon, { name })
const small = (text, extra = '') => jsx('div', { className: `${muted} text-xs ${extra}`, children: text })
const field = (value, set, placeholder) => jsx(Input, { value, placeholder, onChange: e => set(e.target.value) })
const area = (value, set, placeholder, extra = {}) => jsx(Textarea, { value, placeholder, onChange: e => set(e.target.value), ...extra })
const preview = text => jsx('div', { className: `${muted} text-xs whitespace-pre-wrap`, style: { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }, children: text })
const request = async (method, params) => {
  const result = await host.request(method, params)
  if (result?.success === false || result?.ok === false || result?.error) throw new Error(result.message || result.error || 'Request failed')
  return result
}
function timeAgo(value) {
  if (!value) return ''
  const sec = Math.max(0, Math.floor((Date.now() - Number(value) * 1000) / 1000))
  if (sec < 60) return 'just now'
  const [n, unit] = sec < 3600 ? [Math.floor(sec / 60), 'minute'] : sec < 86400 ? [Math.floor(sec / 3600), 'hour'] : [Math.floor(sec / 86400), 'day']
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`
}
function Message({ title, description }) { return jsx(EmptyState, { title, description }) }
function Modal({ title, close, children }) {
  return jsx(Dialog, { open: true, onOpenChange: open => { if (!open) close() }, children: jsxs(DialogContent, { children: [jsx(DialogHeader, { children: jsx(DialogTitle, { children: title }) }), children] }) })
}
function routeId() {
  const hash = window.location.hash.slice(1)
  const q = hash.indexOf('?')
  return q < 0 ? '' : (new URLSearchParams(hash.slice(q + 1)).get('project') || '').slice(0, 128)
}
function App({ ctx, pins, changePin }) {
  const [id, setId] = useState(routeId)
  const profile = useValue(host.state.profile)
  const epoch = useGatewayActivationEpoch()
  useEffect(() => { const fn = () => setId(routeId()); window.addEventListener('hashchange', fn); return () => window.removeEventListener('hashchange', fn) }, [])
  const list = useQuery({ queryKey: ['project-home', epoch, profile, 'projects'], queryFn: () => request('projects.list', {}), refetchInterval: 30000 })
  const projects = (list.data?.projects || []).filter(p => !p.archived)
  useEffect(() => { pins.sync(projects) }, [list.data, profile, epoch])
  if (list.isLoading) return jsx(Message, { title: 'Loading projects…' })
  if (list.error) return jsx(Message, { title: 'Projects unavailable', description: fail(list.error) })
  const project = projects.find(p => p.id === id || p.slug === id)
  if (id && !project) return jsxs('div', { className: 'p-8', children: [button('Projects', () => go()), jsx(Message, { title: 'Project not found', description: 'It may have been archived or belongs to another profile.' })] })
  return project ? jsx(Project, { key: `${epoch}:${project.id}`, ctx, project, projects, pins, changePin, epoch, profile }) : jsx(Hub, { ctx, projects, pins, changePin, epoch, profile })
}
function Hub({ ctx, projects, pins, changePin, epoch, profile }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const activity = useQuery({ queryKey: ['project-home', epoch, profile, 'activity', projects.map(p => p.id).join(',')], queryFn: async () => Object.fromEntries(await Promise.all(projects.map(async p => [p.id, sessionRows(await request('projects.project_sessions', { project_id: p.id })).filter(conversational)]))), refetchInterval: 30000 })
  const filtered = projects.filter(p => `${p.name} ${p.description || ''} ${p.primary_path || ''}`.toLowerCase().includes(search.toLowerCase()))
  const last = p => Math.max(0, ...(activity.data?.[p.id] || []).map(s => Number(s.last_active || s.started_at || 0))) || Number(p.created_at || 0)
  return jsxs('div', { className: 'h-full overflow-auto p-8', children: [
    jsxs('div', { className: 'flex items-center justify-between', children: [jsx('h1', { className: 'text-3xl', style: { fontFamily: 'serif' }, children: 'Projects' }), button('New project', () => setCreating(true), { variant: 'default' })] }),
    jsx('div', { className: 'my-6 max-w-md', children: field(search, setSearch, 'Search projects') }),
    activity.error && small(`Activity unavailable: ${fail(activity.error)}`, 'mb-3'),
    jsx('div', { className: 'overflow-x-auto pb-4', children: jsx('div', { className: 'project-home-board', style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))', gap: 16, minWidth: 928, alignItems: 'stretch' }, children: STATUSES.map(status => {
      const cards = filtered.filter(p => (pins.get(p.id).status || 'To Do') === status).sort((a, b) => Number(pins.has(b.id)) - Number(pins.has(a.id)) || last(b) - last(a))
      return jsxs('section', { className: 'rounded-xl border p-3 ' + border, style: { minWidth: 0, minHeight: '60vh', background: 'var(--ui-bg-secondary)' }, onDragOver: e => e.preventDefault(), onDrop: e => { e.preventDefault(); const p = projects.find(x => x.id === e.dataTransfer.getData('text/plain')); if (p) void pins.update(p, { status }) }, children: [jsxs('h2', { className: 'mb-3 font-medium', children: [status, ' · ', cards.length] }), !cards.length && small('Drop projects here'), ...cards.map(p => jsxs('article', { draggable: true, onDragStart: e => e.dataTransfer.setData('text/plain', p.id), className: `mb-3 rounded-lg border ${border} p-3`, children: [jsxs('div', { className: 'flex items-center justify-between gap-2', children: [jsx('button', { className: 'min-w-0 text-left font-medium', style: { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }, onClick: () => go(p.id), children: jsxs('span', { children: [icon('folder'), ' ', p.name] }) }), button(icon(pins.has(p.id) ? 'pinned' : 'pin'), () => changePin(p), { 'aria-label': pins.has(p.id) ? 'Unpin project' : 'Pin project' })] }), p.description && jsx('p', { className: `mt-2 text-sm ${muted}`, style: { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }, children: p.description }), small(activity.data ? `${activity.data[p.id]?.length || 0} chats · ${timeAgo(last(p))}` : 'Loading activity…', 'mt-2'), jsx('select', { 'aria-label': `Move ${p.name} to`, className: 'mt-2 max-w-full bg-transparent text-xs', value: '', onChange: e => { if (e.target.value) void pins.update(p, { status: e.target.value }) }, children: [jsx('option', { value: '', disabled: true, children: 'Move to…' }), ...STATUSES.filter(s => s !== status).map(s => jsx('option', { value: s, children: s }, s))] })] }, p.id))] }, status)
    }) }) }),
    creating && jsx(CreateProject, { ctx, pins, close: () => setCreating(false), created: () => qc.invalidateQueries({ queryKey: ['project-home'] }) })
  ] })
}
function CreateProject({ ctx, pins, close, created }) {
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [path, setPath] = useState(''), [status, setStatus] = useState('To Do'), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function submit() {
    if (!name.trim() || busy) return
    setBusy(true); setError('')
    let made = null
    const epoch = gatewayActivationEpoch()
    try {
      const folder = await ctx.rest('/folder', { method: 'POST', body: { name: name.trim(), path: path.trim() } })
      if (gatewayActivationEpoch() !== epoch) throw new Error('Connection changed; no project was created.')
      const result = await request('projects.create', { name: name.trim(), description: description.trim(), primary_path: folder.path, folders: [folder.path], use: false })
      made = result.project
      if (!made?.id) throw new Error('Project creation returned no project.')
      if (gatewayActivationEpoch() !== epoch) throw new Error('Connection changed after creation; scaffold was not attempted.')
      await ctx.rest('/scaffold', { method: 'POST', body: { project: made.id } })
      await pins.update(made, { status })
      await created(); close(); go(made.id)
    } catch (e) { setError(`${fail(e)}${made ? ` Project ${made.name} was created but may not be scaffolded.` : ''}`) } finally { setBusy(false) }
  }
  return jsx(Modal, { title: 'New project', close, children: jsxs('div', { className: 'flex flex-col gap-3', children: [field(name, setName, 'Name'), field(description, setDescription, 'Description (optional)'), field(path, setPath, 'Existing folder path (optional)'), jsx('label', { children: jsxs('span', { children: ['Status ', jsx('select', { value: status, className: 'bg-transparent', onChange: e => setStatus(e.target.value), children: STATUSES.map(s => jsx('option', { value: s, children: s }, s)) })] }) }), small('Leave the folder blank to create one under ~/projects.'), error && small(error), button(busy ? 'Creating…' : 'Create project', submit, { variant: 'default', disabled: busy || !name.trim() })] }) })
}
function Project({ ctx, project: p, projects, pins, changePin, epoch, profile }) {
  const qc = useQueryClient()
  const [dialog, setDialog] = useState(''), [search, setSearch] = useState(''), [searchOpen, setSearchOpen] = useState(false), [showAll, setShowAll] = useState(false), [prompt, setPrompt] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [pinOverrides, setPinOverrides] = useState({})
  const model = useValue(host.state.model)
  const [chosenProvider, setChosenProvider] = useState(''), [chosenModel, setChosenModel] = useState(''), [effort, setEffort] = useState(''), [tier, setTier] = useState(''), [showAutomated, setShowAutomated] = useState(false)
  const catalog = useQuery({ queryKey: ['project-home', epoch, profile, 'models'], queryFn: () => request('model.options', { explicit_only: true }), staleTime: 120000, retry: false })
  const providers = (catalog.data?.providers || []).filter(x => x.slug)
  const selectedProvider = providers.find(x => x.slug === chosenProvider)
  const prefix = ['project-home', epoch, profile, p.id]
  const info = useQuery({ queryKey: [...prefix, 'info'], queryFn: () => ctx.rest('/project' + query(p.id)) })
  const instructionsName = info.data?.instructions_file || 'AGENTS.md'
  const instructions = useQuery({ queryKey: [...prefix, 'instructions', instructionsName], queryFn: () => ctx.rest('/file' + query(p.id, instructionsName)), enabled: !!info.data })
  const memory = useQuery({ queryKey: [...prefix, 'memory'], queryFn: () => ctx.rest('/file' + query(p.id, 'MEMORY.md')) })
  const memoryPreview = (memory.data?.content || '').replace(/^\s*#\s+[^\n]*project memory\s*(?:\r?\n|$)/i, '').trim()
  const contexts = useQuery({ queryKey: [...prefix, 'context'], queryFn: () => ctx.rest('/context' + query(p.id)) })
  const sessions = useQuery({ queryKey: [...prefix, 'sessions'], queryFn: async () => { let timer; try { return await Promise.race([request('projects.project_sessions', { project_id: p.id }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Request timed out after 20 seconds.')), 20000) })]) } finally { clearTimeout(timer) } }, retry: false, refetchInterval: 15000 })
  const cron = useQuery({ queryKey: [...prefix, 'cron'], queryFn: () => request('cron.manage', { action: 'list', include_disabled: true }), refetchInterval: 30000 })
  const rows = (sessions.data?.project?.repos || []).flatMap(r => (r.groups || []).flatMap(g => g.sessions || []))
  const unique = [...new Map(rows.map(s => [s.id, s])).values()].sort((a, b) => (b.last_active || b.started_at || 0) - (a.last_active || a.started_at || 0))
  const visible = unique.filter(s => (showAutomated || conversational(s)) && `${s.title || s.preview || ''}`.toLowerCase().includes(search.toLowerCase()))
  const pinIds = visible.slice(0, 100).map(s => s._lineage_root_id || s.id)
  const pinQuery = useQuery({ queryKey: [...prefix, 'pins', pinIds.join(',')], queryFn: () => ctx.rest('/pins?ids=' + enc(pinIds.join(','))), enabled: pinIds.length > 0 })
  const automatedCount = unique.filter(s => !conversational(s)).length
  const root = (p.primary_path || '').replace(/\/+$/, '')
  const jobs = (cron.data?.jobs || []).filter(j => typeof j.workdir === 'string' && (j.workdir === root || j.workdir.startsWith(root + '/')))
  async function send() {
    if (!prompt.trim() || busy || !root) return
    const text = prompt.trim(), captured = gatewayActivationEpoch(); setBusy(true); setError('')
    try {
      const created = await request('session.create', { cwd: root, cwd_explicit: true, source: 'desktop', ...(chosenModel ? { model: chosenModel, provider: chosenProvider } : {}), ...(effort ? { reasoning_effort: effort } : {}), ...(tier ? { service_tier: tier } : {}) })
      if (!created.session_id || !created.stored_session_id) throw new Error('Session creation returned no session id.')
      if (gatewayActivationEpoch() !== captured) throw new Error('Connection changed; the new session was not sent a prompt.')
      await request('prompt.submit', { session_id: created.session_id, text, submission_id: crypto.randomUUID() })
      setPrompt('')
      if (gatewayActivationEpoch() !== captured) throw new Error('Prompt sent on the previous connection; open that connection to view it.')
      await host.openSession(created.stored_session_id)
    } catch (e) { setError(fail(e)) } finally { setBusy(false) }
  }
  async function jobAction(job, action) {
    try { await request('cron.manage', { action, name: job.job_id }); await cron.refetch() } catch (e) { setError(fail(e)) }
  }
  return jsxs('div', { className: 'h-full overflow-auto', children: [
    jsxs('div', { className: `flex items-center justify-between border-b ${border} px-8 py-4`, children: [jsxs('div', { className: 'flex items-center gap-2', children: [jsx('button', { onClick: () => go(), children: 'Projects' }), jsx('span', { className: muted, children: '/' }), jsx('select', { className: 'bg-transparent', style: { fieldSizing: 'content', maxWidth: '15rem' }, value: p.id, onChange: e => { if (e.target.value === '__rename') setDialog('rename'); else if (e.target.value === '__archive') setDialog('archive'); else if (e.target.value === '__folder') void ctx.runAction('view.showFiles'); else go(e.target.value) }, children: [ ...projects.map(x => jsx('option', { value: x.id, children: x.name }, x.id)), jsx('option', { value: '__rename', children: 'Rename…' }), jsx('option', { value: '__folder', children: 'Open file browser' }), jsx('option', { value: '__archive', children: 'Archive…' })] })] }), jsxs('div', { className: 'flex gap-2', children: [button(icon('search'), () => setSearchOpen(!searchOpen), { 'aria-label': 'Search recents' }), button(icon(pins.has(p.id) ? 'pinned' : 'pin'), () => changePin(p), { 'aria-label': pins.has(p.id) ? 'Unpin project' : 'Pin project' })] })] }),
    jsxs('div', { className: 'mx-auto max-w-6xl px-8 py-12', children: [jsx('h1', { className: 'mb-10 text-4xl', style: { fontFamily: 'serif' }, children: p.name }), jsx('style', { children: '.project-home-columns{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:48px}.project-home-columns>*{min-width:0;box-sizing:border-box}.project-home-columns textarea{width:100%;max-width:100%;box-sizing:border-box}@media(max-width:900px){.project-home-columns{grid-template-columns:minmax(0,1fr)}}' }), jsxs('div', { className: 'project-home-columns', children: [
      jsxs('main', { children: [jsxs('div', { className: `rounded-xl border ${border} p-4`, children: [area(prompt, setPrompt, `New session in ${p.name}`, { rows: 4, onKeyDown: e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } } }), jsxs('div', { className: 'mt-2 flex items-end justify-between gap-2', children: [jsxs('div', { className: 'flex min-w-0 flex-1 flex-wrap items-center gap-2', children: [jsx('select', { 'aria-label': 'Provider', value: chosenProvider, className: 'max-w-full bg-transparent', style: { width: 120 }, onChange: e => { setChosenProvider(e.target.value); setChosenModel('') }, children: [jsx('option', { value: '', children: 'Default provider' }), ...providers.map(x => jsx('option', { value: x.slug, children: x.name || x.slug }, x.slug))] }), jsx('select', { 'aria-label': 'Model', value: chosenModel, disabled: !chosenProvider, className: 'max-w-full bg-transparent', style: { width: 185 }, onChange: e => setChosenModel(e.target.value), children: [jsx('option', { value: '', children: model ? `Default (${model.replace(/\[.*?\]$/, '')})` : 'Default model' }), ...(selectedProvider?.models || []).map(x => { const id = typeof x === 'string' ? x : x.id || x.name; return jsx('option', { value: id, children: typeof x === 'string' ? x : x.name || id }, id) })] }), jsx('select', { 'aria-label': 'Reasoning effort', value: effort, className: 'bg-transparent', onChange: e => setEffort(e.target.value), children: ['', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(x => jsx('option', { value: x, children: x || 'Default effort' }, x)) }), jsx('select', { 'aria-label': 'Service tier', value: tier, className: 'bg-transparent', onChange: e => setTier(e.target.value), children: ['', 'normal', 'priority', 'flex'].map(x => jsx('option', { value: x, children: x || 'Default tier' }, x)) })] }), button(busy ? 'Starting…' : 'Send', send, { variant: 'default', disabled: busy || !prompt.trim() || !root })] })] }), catalog.error && small(`Model catalog unavailable: ${fail(catalog.error)}`), error && small(error, 'mt-4'), jsxs('div', { className: 'mt-4', children: [small('Recents', 'mb-3'), button(`${showAutomated ? 'Hide' : 'Show'} automated runs (${automatedCount})`, () => setShowAutomated(!showAutomated)), searchOpen && field(search, setSearch, 'Search recents'), sessions.isLoading ? small('Loading sessions…') : sessions.error ? jsxs('div', { children: [small(`Could not load sessions: ${fail(sessions.error)}`), button('Retry', () => sessions.refetch())] }) : !visible.length ? small(search ? 'No matching sessions.' : 'No recent sessions.') : (showAll ? visible : visible.slice(0, 10)).map(s => { const sid = s._lineage_root_id || s.id; const pinned = pinOverrides[sid] ?? pinQuery.data?.pinned?.[sid] ?? false; return jsxs('div', { className: `group flex items-center gap-3 border-b ${border} py-3`, children: [jsx('button', { className: 'min-w-0 flex-1 truncate text-left', onClick: () => void host.openSession(sid), children: s.title || s.preview || 'Untitled session' }), small(timeAgo(s.last_active || s.started_at)), button(icon(pinned ? 'pinned' : 'pin'), () => { if (!host.sessions?.pin) { setError('Session pinning requires a newer Desktop SDK.'); return } host.sessions.pin(sid, !pinned); setPinOverrides(v => ({ ...v, [sid]: !pinned })) }, { 'aria-label': pinned ? 'Unpin session' : 'Pin session', className: 'opacity-0 group-hover:opacity-100 focus:opacity-100' })] }, s.id) }), visible.length > 10 && button(showAll ? 'Show less' : 'Show all', () => setShowAll(!showAll))] })] }),
      jsxs('aside', { children: [jsx(ProjectNotes, { ctx, project: p.id, refreshInstructions: () => qc.invalidateQueries({ queryKey: prefix }) }), info.data?.instructions_message && small(`${info.data.instructions_message} ${(info.data.ancestor_instruction_sources || []).join(', ')}`, 'mb-3'), info.error && jsx(Message, { title: 'Plugin backend unavailable', description: 'Enable the project-home backend for this profile and restart the gateway.' }),
        jsx(SideRow, { iconName: 'note', label: 'Instructions', action: 'Edit', onClick: () => setDialog('instructions'), children: instructions.isLoading ? small('Loading…') : instructions.error ? small(fail(instructions.error)) : instructions.data?.content ? preview(instructions.data.content) : small('No instructions yet.') }),
        jsx(SideRow, { iconName: 'files', label: 'Context', action: 'Add', onClick: () => setDialog('context-add'), children: contexts.isLoading ? small('Loading…') : contexts.error ? small(fail(contexts.error)) : (contexts.data?.files || []).length ? contexts.data.files.map(f => jsx('button', { className: `block w-full truncate py-1 text-left text-xs ${muted}`, onClick: () => setDialog(`context:${f.name}`), children: `${f.name} · ${f.size} B` }, f.name)) : small('No context files.') }),
        jsx(SideRow, { iconName: 'book', label: 'Memory', action: 'View', onClick: () => setDialog('memory'), children: memory.isLoading ? small('Loading…') : memory.error ? small(fail(memory.error)) : memoryPreview ? preview(memoryPreview) : small('No memory yet.') }),
        jsx(SideRow, { iconName: 'clock', label: 'Scheduled', action: 'Add', onClick: () => setDialog('cron-add'), children: cron.isLoading ? small('Loading…') : cron.error ? small(fail(cron.error)) : jobs.length ? jobs.map(j => jsxs('div', { className: 'py-2 text-xs', children: [jsx('div', { children: j.name || j.job_id }), jsxs('div', { className: 'flex gap-2', children: [button(j.enabled === false ? 'Resume' : 'Pause', () => jobAction(j, j.enabled === false ? 'resume' : 'pause')), button('Remove', () => { if (window.confirm(`Remove scheduled job ${j.name || j.job_id}?`)) void jobAction(j, 'remove') })] })] }, j.job_id)) : small('No scheduled jobs.') }), small(p.primary_path || 'No project folder', 'mt-8 break-all') ] })
    ] })] }),
    (dialog === 'instructions' || dialog === 'memory') && jsx(FileEditor, { key: dialog, ctx, project: p.id, name: dialog === 'instructions' ? instructionsName : 'MEMORY.md', close: () => setDialog(''), done: () => qc.invalidateQueries({ queryKey: prefix }) }),
    dialog === 'context-add' && jsx(ContextAdd, { ctx, project: p.id, close: () => setDialog(''), done: () => contexts.refetch() }),
    dialog.startsWith('context:') && jsx(ContextView, { ctx, project: p.id, name: dialog.slice(8), close: () => setDialog('') }),
    dialog === 'cron-add' && jsx(CronAdd, { ctx, project: p.id, close: () => setDialog(''), done: () => cron.refetch() }),
    dialog === 'rename' && jsx(Rename, { project: p, close: () => setDialog(''), done: () => qc.invalidateQueries({ queryKey: ['project-home'] }) }),
    dialog === 'archive' && jsx(Modal, { title: 'Archive project?', close: () => setDialog(''), children: jsxs('div', { children: [small('The folder and its files will not be deleted.'), button('Archive', async () => { try { await request('projects.archive', { id: p.id }); await qc.invalidateQueries({ queryKey: ['project-home'] }); go() } catch (e) { setError(fail(e)); setDialog('') } })] }) })
  ] })
}
function ProjectNotes({ ctx, project, refreshInstructions }) {
  const [text, setText] = useState(''), [saved, setSaved] = useState(''), [mtime, setMtime] = useState(null), [exists, setExists] = useState(false), [loading, setLoading] = useState(true), [loadFailed, setLoadFailed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { let live = true; ctx.rest('/file' + query(project, 'PROJECT_NOTES.md')).then(r => { if (live) { setText(r.content || ''); setSaved(r.content || ''); setMtime(r.mtime); setExists(r.exists); setLoading(false) } }, e => { if (live) { setError(fail(e)); setLoadFailed(true); setLoading(false) } }); return () => { live = false } }, [project])
  async function save() {
    if (busy || loading) return
    setBusy(true); setError('')
    try {
      const result = await ctx.rest('/file' + query(project, 'PROJECT_NOTES.md'), { method: 'PUT', body: { content: text, expected_mtime: mtime, expected_exists: exists } })
      setMtime(result.mtime); setExists(true); setSaved(text)
      try { await ctx.rest('/notes/enable', { method: 'POST', body: { project } }); await refreshInstructions() } catch (e) { setError(`Notes saved, but agent awareness could not be enabled (ancestor or higher-priority instructions may shadow this project): ${fail(e)}`) }
    } catch (e) { setError(fail(e)) } finally { setBusy(false) }
  }
  return jsxs('section', { className: `mb-6 rounded-xl border ${border} p-4`, children: [jsx('h2', { className: 'font-medium', children: 'Project notes' }), small('Your objectives, considerations, and high-level direction — not a detailed plan or standing instructions.', 'my-2'), area(text, setText, 'Objectives, things to consider, work to keep in mind', { rows: 7, disabled: loading || busy || loadFailed }), jsxs('div', { className: 'mt-3 flex items-center gap-3', children: [button(busy ? 'Saving…' : 'Save', save, { variant: 'default', disabled: loading || busy || loadFailed }), small(error ? `Error: ${error}` : busy ? 'Saving…' : text === saved ? 'Saved' : 'Unsaved')] })] })
}
function SideRow({ iconName, label, action, onClick, children }) { return jsxs('section', { className: `border-b ${border} py-4`, children: [jsxs('div', { className: 'flex items-center justify-between gap-2', children: [jsxs('div', { className: 'flex items-center gap-2', children: [icon(iconName), label] }), jsx('button', { className: `text-sm ${muted}`, onClick, children: action })] }), children && jsx('div', { className: 'mt-2', children })] }) }
function FileEditor({ ctx, project, name, close, done }) {
  const [content, setContent] = useState(''), [mtime, setMtime] = useState(null), [exists, setExists] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  useEffect(() => { let live = true; ctx.rest('/file' + query(project, name)).then(r => { if (live) { setContent(r.content || ''); setMtime(r.mtime); setExists(r.exists); setLoading(false) } }, e => { if (live) { setError(fail(e)); setLoading(false) } }); return () => { live = false } }, [project, name])
  async function save() { setBusy(true); setError(''); try { await ctx.rest('/file' + query(project, name), { method: 'PUT', body: { content, expected_mtime: mtime, expected_exists: exists } }); await done(); close() } catch (e) { setError(fail(e)) } finally { setBusy(false) } }
  return jsx(Modal, { title: name, close, children: jsxs('div', { className: 'flex flex-col gap-3', children: [loading ? small('Loading…') : area(content, setContent, '', { rows: 16 }), error && small(error), button(busy ? 'Saving…' : 'Save', save, { variant: 'default', disabled: busy || loading || (mtime === null && !!error) })] }) })
}
function ContextAdd({ ctx, project, close, done }) {
  const [title, setTitle] = useState(''), [body, setBody] = useState(''), [file, setFile] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit() { setBusy(true); setError(''); try { if (file) await ctx.rest('/context/upload' + query(project), { method: 'POST', upload: { filename: file.name, contentType: file.type || 'application/octet-stream', bytes: await file.arrayBuffer() } }); else await ctx.rest('/context', { method: 'POST', body: { project, title: title.trim(), body } }); await done(); close() } catch (e) { setError(fail(e)) } finally { setBusy(false) } }
  return jsx(Modal, { title: 'Add context', close, children: jsxs('div', { className: 'flex flex-col gap-3', children: [field(title, setTitle, 'Note title'), area(body, setBody, 'Note text', { rows: 8 }), small('Or upload a file (up to 10 MiB):'), jsx('input', { type: 'file', onChange: e => setFile(e.target.files?.[0] || null) }), error && small(error), button(busy ? 'Adding…' : file ? 'Upload' : 'Add note', submit, { disabled: busy || (!file && !title.trim()) })] }) })
}
function ContextView({ ctx, project, name, close }) {
  const epoch = useGatewayActivationEpoch()
  const data = useQuery({ queryKey: ['project-home', epoch, project, 'context-file', name], queryFn: () => ctx.rest('/context/file' + query(project, name)) })
  return jsx(Modal, { title: name, close, children: data.isLoading ? small('Loading…') : data.error ? small(fail(data.error)) : jsx('pre', { className: 'max-h-96 overflow-auto whitespace-pre-wrap break-all text-sm', children: data.data?.content || '(empty)' }) })
}
function CronAdd({ ctx, project, close, done }) {
  const [name, setName] = useState(''), [schedule, setSchedule] = useState(''), [prompt, setPrompt] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit() { setBusy(true); setError(''); try { await ctx.rest('/cron', { method: 'POST', body: { project, name: name.trim(), schedule: schedule.trim(), prompt: prompt.trim() } }); await done(); close() } catch (e) { setError(fail(e)) } finally { setBusy(false) } }
  return jsx(Modal, { title: 'Schedule a task', close, children: jsxs('div', { className: 'flex flex-col gap-3', children: [field(name, setName, 'Name'), field(schedule, setSchedule, 'Schedule, e.g. every day at 9am'), area(prompt, setPrompt, 'Prompt', { rows: 6 }), error && small(error), button(busy ? 'Adding…' : 'Add scheduled task', submit, { disabled: busy || !name.trim() || !schedule.trim() || !prompt.trim() })] }) })
}
function Rename({ project, close, done }) {
  const [name, setName] = useState(project.name), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function save() { setBusy(true); try { await request('projects.update', { id: project.id, name: name.trim() }); await done(); close() } catch (e) { setError(fail(e)) } finally { setBusy(false) } }
  return jsx(Modal, { title: 'Rename project', close, children: jsxs('div', { className: 'flex flex-col gap-3', children: [field(name, setName, 'Project name'), error && small(error), button('Save', save, { disabled: busy || !name.trim() })] }) })
}
export default {
  id: 'project-home', name: 'Project Home', version: '0.2.0', defaultEnabled: false,
  register(ctx) {
    let board = {}, disposers = [], listeners = new Set(), known = [], retired = false, generation = 0
    const storageKey = () => `pinned-projects:${host.state.connectionId?.get() || 'local'}:${host.state.profile.get() || 'default'}`
    function sync(projects) {
      known = projects
      for (const dispose of disposers) dispose()
      disposers = projects.filter(p => board[p.id]?.pinned).map((p, i) => ctx.register({ id: `pin-${i}`, area: SIDEBAR_NAV_AREA, order: 101 + i, data: { path: `${BASE}?project=${enc(p.id)}`, label: p.name, codicon: 'project' } }))
    }
    function publish() { sync(known); for (const fn of listeners) fn() }
    const pins = { has: id => !!board[id]?.pinned, get: id => board[id] || {}, sync }
    async function updateBoard(p, patch) {
      const current = generation
      try {
        const result = await ctx.rest('/board/' + enc(p.id), { method: 'PUT', body: patch })
        if (!retired && current === generation) { board = result.projects; publish() }
      } catch (e) { host.notify({ kind: 'error', message: `Project board: ${fail(e)}` }) }
    }
    function changePin(p) { void updateBoard(p, { pinned: !pins.has(p.id) }) }
    pins.update = updateBoard
    function refreshPinned() {
      const current = ++generation, key = storageKey()
      board = {}; sync([]); publish()
      Promise.all([request('projects.list', {}), ctx.rest('/board')]).then(async ([result, saved]) => {
        if (retired || current !== generation) return
        known = (result.projects || []).filter(p => !p.archived); board = saved.projects || {}; publish()
        const legacy = ctx.storage.get(key, [])
        for (const id of Array.isArray(legacy) ? legacy : []) {
          if (retired || current !== generation) return
          if (!board[id] && known.some(p => p.id === id)) {
            const migrated = await ctx.rest('/board/' + enc(id), { method: 'PUT', body: { pinned: true } })
            if (retired || current !== generation) return
            board = migrated.projects; publish()
          }
        }
        ctx.storage.remove(key)
      }).catch(e => host.notify({ kind: 'error', message: `Project board: ${fail(e)}` }))
    }
    const stopProfile = host.state.profile.listen(refreshPinned)
    const stopConnection = host.state.connectionId?.listen(refreshPinned) || (() => {})
    refreshPinned()
    function Page() { const [, refresh] = useState(0); useEffect(() => { const fn = () => refresh(n => n + 1); listeners.add(fn); return () => listeners.delete(fn) }, []); return jsx(App, { ctx, pins, changePin }) }
    ctx.register({ id: 'page', area: ROUTES_AREA, data: { path: BASE }, render: () => jsx(Page, {}) })
    ctx.register({ id: 'nav', area: SIDEBAR_NAV_AREA, order: 100, data: { path: BASE, label: 'Projects', codicon: 'project' } })
    ctx.register({ id: 'open', area: PALETTE_AREA, data: { id: 'project-home.open', label: 'Open Projects', keywords: ['projects'], run: () => go() } })
    ctx.onDispose(() => { retired = true; stopProfile(); stopConnection(); for (const dispose of disposers) dispose(); listeners.clear() })
  }
}
