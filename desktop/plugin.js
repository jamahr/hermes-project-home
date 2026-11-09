import { host, COMPOSER_AREAS, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, ROUTES_AREA, SIDEBAR_NAV_AREA, PALETTE_AREA, Button, Input, Textarea, SegmentedControl, ConfirmDialog, CopyButton, Dialog, DialogContent, DialogHeader, DialogTitle, Codicon, EmptyState, useQuery, useQueryClient, useValue, gatewayActivationEpoch, useGatewayActivationEpoch } from '@hermes/plugin-sdk'
import { useState, useEffect, useRef } from 'react'
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
const humanSize = n => { n = Number(n) || 0; return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB` }
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
async function openProjectChat(project) {
  const epoch = gatewayActivationEpoch()
  const profile = host.state.profile.get()
  const result = await request('session.create', { cwd: project.primary_path, source: 'desktop', profile })
  if (!result?.stored_session_id) throw new Error('Session creation returned no stored ID')
  if (gatewayActivationEpoch() !== epoch) throw new Error('Connection changed while opening chat')
  await host.openSession(result.stored_session_id)
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
  const [dialog, setDialog] = useState(''), [search, setSearch] = useState(''), [searchOpen, setSearchOpen] = useState(false), [showAll, setShowAll] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [pinOverrides, setPinOverrides] = useState({})
  const [showAutomated, setShowAutomated] = useState(false), [removeJob, setRemoveJob] = useState(null)
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
  const visible = unique.filter(s => (showAutomated ? !conversational(s) : conversational(s)) && `${s.title || s.preview || ''}`.toLowerCase().includes(search.toLowerCase()))
  const pinIds = visible.slice(0, 100).map(s => s._lineage_root_id || s.id)
  const pinQuery = useQuery({ queryKey: [...prefix, 'pins', pinIds.join(',')], queryFn: () => ctx.rest('/pins?ids=' + enc(pinIds.join(','))), enabled: pinIds.length > 0 })
  const automatedCount = unique.filter(s => !conversational(s)).length
  const root = (p.primary_path || '').replace(/\/+$/, '')
  const jobs = (cron.data?.jobs || []).filter(j => typeof j.workdir === 'string' && (j.workdir === root || j.workdir.startsWith(root + '/')))
  async function newChat() {
    if (busy || !root) return
    setBusy(true)
    try { await openProjectChat(p) } catch (e) { host.notify({ kind: 'error', message: `New chat: ${fail(e)}` }) } finally { setBusy(false) }
  }
  async function jobAction(job, action) {
    try { await request('cron.manage', { action, name: job.job_id }); await cron.refetch() } catch (e) { setError(fail(e)) }
  }
  return jsxs('div', { className: 'h-full overflow-auto', children: [
    jsxs('div', { className: `flex items-center justify-between border-b ${border} px-8 py-4`, children: [jsxs('div', { className: 'flex items-center gap-2', children: [jsx('button', { onClick: () => go(), children: 'Projects' }), jsx('span', { className: muted, children: '/' }), jsx('select', { className: 'bg-transparent', style: { fieldSizing: 'content', maxWidth: '15rem' }, value: p.id, onChange: e => { if (e.target.value === '__rename') setDialog('rename'); else if (e.target.value === '__archive') setDialog('archive'); else if (e.target.value === '__folder') void ctx.runAction('view.showFiles'); else go(e.target.value) }, children: [ ...projects.map(x => jsx('option', { value: x.id, children: x.name }, x.id)), jsx('option', { value: '__rename', children: 'Rename…' }), jsx('option', { value: '__folder', children: 'Open file browser' }), jsx('option', { value: '__archive', children: 'Archive…' })] })] }), jsxs('div', { className: 'flex gap-2', children: [button(icon('search'), () => setSearchOpen(!searchOpen), { 'aria-label': 'Search recents' }), button(icon(pins.has(p.id) ? 'pinned' : 'pin'), () => changePin(p), { 'aria-label': pins.has(p.id) ? 'Unpin project' : 'Pin project' })] })] }),
    jsxs('div', { className: 'mx-auto max-w-6xl px-8 py-12', children: [jsxs('div', { className: 'mb-10', children: [jsx('h1', { className: 'text-4xl', style: { fontFamily: 'serif' }, children: p.name }), p.description && jsx('p', { className: `mt-2 ${muted}`, children: p.description })] }), jsx('style', { children: '.project-home-columns{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:48px}.project-home-columns>*{min-width:0;box-sizing:border-box}.project-home-columns textarea{width:100%;max-width:100%;box-sizing:border-box}@media(max-width:900px){.project-home-columns{grid-template-columns:minmax(0,1fr)}}' }), jsxs('div', { className: 'project-home-columns', children: [
      jsxs('main', { children: [button(busy ? 'Opening…' : 'New session', newChat, { variant: 'default', className: 'px-5 py-3 text-base', disabled: busy || !root }), small("Starts a chat that uses this project's notes, instructions and context.", 'mt-2'), error && small(error, 'mt-4'), jsxs('div', { className: 'mt-4', children: [jsx('h2', { className: 'mb-3 font-medium', children: 'Recents' }), jsx(SegmentedControl, { value: showAutomated ? 'automated' : 'chats', onChange: v => setShowAutomated(v === 'automated'), options: [{ id: 'chats', label: 'Chats' }, { id: 'automated', label: `Automated (${automatedCount})` }] }), searchOpen && field(search, setSearch, 'Search recents'), sessions.isLoading ? small('Loading sessions…') : sessions.error ? jsxs('div', { children: [small(`Could not load sessions: ${fail(sessions.error)}`), button('Retry', () => sessions.refetch())] }) : !visible.length ? small(search ? 'No matching sessions.' : 'No recent sessions.') : (showAll ? visible : visible.slice(0, 10)).map(s => { const sid = s._lineage_root_id || s.id; const pinned = pinOverrides[sid] ?? pinQuery.data?.pinned?.[sid] ?? false; return jsxs('div', { className: `group flex cursor-pointer items-center gap-3 border-b ${border} py-3 hover:bg-(--ui-bg-secondary)`, onClick: () => void host.openSession(sid), children: [jsx('button', { className: 'min-w-0 flex-1 truncate text-left', onClick: e => { e.stopPropagation(); void host.openSession(sid) }, children: s.title || s.preview || 'Untitled session' }), small(timeAgo(s.last_active || s.started_at)), jsx('span', { className: 'opacity-0 group-hover:opacity-100', children: icon('chevron-right') }), button(icon(pinned ? 'pinned' : 'pin'), e => { e.stopPropagation(); if (!host.sessions?.pin) { setError('Session pinning requires a newer Desktop SDK.'); return } host.sessions.pin(sid, !pinned); setPinOverrides(v => ({ ...v, [sid]: !pinned })) }, { 'aria-label': pinned ? 'Unpin session' : 'Pin session', className: 'opacity-0 group-hover:opacity-100 focus:opacity-100' })] }, s.id) }), visible.length > 10 && button(showAll ? 'Show less' : 'Show all', () => setShowAll(!showAll))] })] }),
      jsxs('aside', { children: [jsx(ProjectNotes, { ctx, project: p.id, refreshInstructions: () => qc.invalidateQueries({ queryKey: prefix }) }), info.data?.instructions_message && small(`${info.data.instructions_message} ${(info.data.ancestor_instruction_sources || []).join(', ')}`, 'mb-3'), info.error && jsx(Message, { title: 'Plugin backend unavailable', description: 'Enable the project-home backend for this profile and restart the gateway.' }),
        jsx(SideRow, { iconName: 'note', label: 'Instructions', action: 'Edit', onClick: () => setDialog('instructions'), children: instructions.isLoading ? small('Loading…') : instructions.error ? small(fail(instructions.error)) : instructions.data?.content ? preview(instructions.data.content) : small('No instructions yet.') }),
        jsx(SideRow, { iconName: 'files', label: 'Context', action: 'Add', onClick: () => setDialog('context-add'), children: contexts.isLoading ? small('Loading…') : contexts.error ? small(fail(contexts.error)) : (contexts.data?.files || []).length ? jsx(ContextFiles, { files: contexts.data.files, truncated: contexts.data.truncated, open: path => setDialog(`context:${path}`) }) : small('Files the agent should know about.') }),
        jsx(SideRow, { iconName: 'book', label: 'Memory', action: memoryPreview ? 'View' : 'Edit', onClick: () => setDialog('memory'), children: memory.isLoading ? small('Loading…') : memory.error ? small(fail(memory.error)) : memoryPreview ? preview(memoryPreview) : small('Facts the agent records about this project.') }),
        jsx(SideRow, { iconName: 'clock', label: 'Scheduled', action: 'Add', onClick: () => setDialog('cron-add'), children: cron.isLoading ? small('Loading…') : cron.error ? small(fail(cron.error)) : jobs.length ? jobs.map(j => jsx(ScheduledRow, { job: j, action: jobAction, remove: () => setRemoveJob(j) }, j.job_id)) : small('No scheduled jobs.') }), jsxs('div', { className: `mt-8 flex items-center gap-2 font-mono text-xs ${muted}`, children: [jsx('span', { className: 'break-all', children: p.primary_path || 'No project folder' }), p.primary_path && jsx(CopyButton, { text: p.primary_path, appearance: 'icon', label: 'Copy project path' })] }) ] })
    ] })] }),
    (dialog === 'instructions' || dialog === 'memory') && jsx(FileEditor, { key: dialog, ctx, project: p.id, name: dialog === 'instructions' ? instructionsName : 'MEMORY.md', close: () => setDialog(''), done: () => qc.invalidateQueries({ queryKey: prefix }) }),
    removeJob && jsx(ConfirmDialog, { open: true, onClose: () => setRemoveJob(null), title: `Remove ${removeJob.name || removeJob.job_id}?`, description: 'This scheduled task will be removed.', confirmLabel: 'Remove', destructive: true, onConfirm: async () => { await request('cron.manage', { action: 'remove', name: removeJob.job_id }); await cron.refetch() } }),
    dialog === 'context-add' && jsx(ContextAdd, { ctx, project: p.id, close: () => setDialog(''), done: () => contexts.refetch() }),
    dialog.startsWith('context:') && jsx(ContextView, { ctx, project: p.id, name: dialog.slice(8), file: (contexts.data?.files || []).find(f => f.path === dialog.slice(8)), close: () => setDialog('') }),
    dialog === 'cron-add' && jsx(CronAdd, { ctx, project: p.id, close: () => setDialog(''), done: () => cron.refetch() }),
    dialog === 'rename' && jsx(Rename, { project: p, close: () => setDialog(''), done: () => qc.invalidateQueries({ queryKey: ['project-home'] }) }),
    dialog === 'archive' && jsx(Modal, { title: 'Archive project?', close: () => setDialog(''), children: jsxs('div', { children: [small('The folder and its files will not be deleted.'), button('Archive', async () => { try { await request('projects.archive', { id: p.id }); await qc.invalidateQueries({ queryKey: ['project-home'] }); go() } catch (e) { setError(fail(e)); setDialog('') } })] }) })
  ] })
}
function ContextFiles({ files, truncated, open }) {
  const [all, setAll] = useState(false)
  const shown = all ? files : files.slice(0, 10)
  const groups = new Map()
  for (const f of shown) { const path = f.path || f.name; const group = path.includes('/') ? path.split('/')[0] : ''; if (!groups.has(group)) groups.set(group, []); groups.get(group).push(f) }
  const row = f => jsx('button', { className: `block w-full truncate py-1 text-left text-xs ${muted}`, onClick: () => open(f.path || f.name), children: `${f.path || f.name} · ${humanSize(f.size)}` }, f.path || f.name)
  return jsxs('div', { children: [ ...(groups.get('') || []).map(row), ...Array.from(groups.entries()).filter(([name]) => name).map(([name, list]) => jsxs('details', { children: [jsx('summary', { children: `${name} (${files.filter(f => (f.path || f.name).startsWith(name + '/')).length})` }), ...list.map(row)] }, name)), files.length > 10 && button(all ? 'Show less' : `Show all (${files.length})`, () => setAll(!all)), truncated && small('Listing truncated at 2000 files.')] })
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
  return jsxs('section', { className: `mb-6 rounded-xl border ${border} p-4`, children: [jsx('h2', { className: 'font-medium', children: 'Project notes' }), small('Your objectives, considerations, and high-level direction — not a detailed plan or standing instructions.', 'my-2'), area(text, setText, 'Objectives, things to consider, work to keep in mind', { rows: 7, disabled: loading || busy || loadFailed, onKeyDown: e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (text !== saved) void save() } } }), jsxs('div', { className: 'mt-3 flex items-center gap-3', children: [button(busy ? 'Saving…' : 'Save', save, { variant: 'default', disabled: loading || busy || loadFailed || text === saved }), small(error ? `Error: ${error}` : busy ? 'Saving…' : text === saved ? 'Saved' : 'Unsaved changes')] })] })
}
function SideRow({ iconName, label, action, onClick, children }) { return jsxs('section', { className: `border-b ${border} py-4`, children: [jsxs('div', { className: 'flex items-center justify-between gap-2', children: [jsxs('div', { className: 'flex items-center gap-2', children: [icon(iconName), label] }), jsx('button', { className: `text-sm ${muted}`, onClick, children: action })] }), children && jsx('div', { className: 'mt-2', children })] }) }
function FileEditor({ ctx, project, name, close, done }) {
  const [content, setContent] = useState(''), [mtime, setMtime] = useState(null), [exists, setExists] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  useEffect(() => { let live = true; ctx.rest('/file' + query(project, name)).then(r => { if (live) { setContent(r.content || ''); setMtime(r.mtime); setExists(r.exists); setLoading(false) } }, e => { if (live) { setError(fail(e)); setLoading(false) } }); return () => { live = false } }, [project, name])
  async function save() { setBusy(true); setError(''); try { await ctx.rest('/file' + query(project, name), { method: 'PUT', body: { content, expected_mtime: mtime, expected_exists: exists } }); await done(); close() } catch (e) { setError(fail(e)) } finally { setBusy(false) } }
  return jsx(Modal, { title: name, close, children: jsxs('div', { className: 'flex flex-col gap-3', children: [loading ? small('Loading…') : area(content, setContent, '', { rows: 16 }), error && small(error), button(busy ? 'Saving…' : 'Save', save, { variant: 'default', disabled: busy || loading || (mtime === null && !!error) })] }) })
}
// v4 upload helpers
const UPLOAD_LIMIT = 10 * 1024 * 1024
const BATCH_BYTES = 500 * 1024 * 1024
const isJunk = path => path.split('/').some(part => ['.ds_store', 'thumbs.db', 'desktop.ini', '__macosx', '.git'].includes(part.toLowerCase()))
async function collectEntries(entries) {
  const found = []
  async function visit(entry, prefix = '') {
    const path = prefix + entry.name
    if (isJunk(path)) { found.push({ path, junk: true }); return }
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject))
      found.push({ path, file })
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))
        if (!batch.length) break
        for (const child of batch) await visit(child, path + '/')
      }
    }
  }
  for (const entry of entries) if (entry) await visit(entry)
  return found
}
function prepareBatch(entries) {
  let junk = 0, bytes = 0
  const items = []
  for (const item of entries) {
    if (item.junk || isJunk(item.path)) { junk++; continue }
    bytes += item.file.size
    items.push({ ...item, status: item.status || (item.file.size > UPLOAD_LIMIT ? 'skipped' : 'pending'), reason: item.reason || (item.file.size > UPLOAD_LIMIT ? 'Exceeds 10 MiB' : '') })
  }
  if (items.length > 1000 || bytes > BATCH_BYTES) throw new Error('Batch limit is 1000 files and 500 MiB.')
  return { items, junk, bytes }
}
async function uploadBatch(ctx, project, items, policy, cancelled, update) {
  for (const item of items) {
    if (cancelled()) break
    if (!['pending', 'failed'].includes(item.status)) continue
    item.status = 'uploading'; item.reason = ''; update()
    try {
      const url = `/context/upload?project=${encodeURIComponent(project)}&path=${encodeURIComponent(item.path)}&on_conflict=${encodeURIComponent(policy)}`
      const result = await ctx.rest(url, { method: 'POST', upload: { filename: item.file.name, contentType: item.file.type || 'application/octet-stream', bytes: await item.file.arrayBuffer() } })
      item.status = result.status; item.reason = result.path !== item.path ? `Saved as ${result.path}` : ''
    } catch (e) { item.status = 'failed'; item.reason = e instanceof Error ? e.message : String(e) }
    update()
  }
}
// end v4 upload helpers
function ContextAdd({ ctx, project, close, done }) {
  const [title, setTitle] = useState(''), [body, setBody] = useState(''), [items, setItems] = useState([]), [junk, setJunk] = useState(0), [policy, setPolicy] = useState('rename'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [finished, setFinished] = useState(false)
  const cancelled = useRef(false), filesRef = useRef(null), folderRef = useRef(null)
  const [tab, setTab] = useState('upload'), [dragging, setDragging] = useState(false), [progress, setProgress] = useState({ current: 0, total: 0 })
  async function add(entries) {
    try { const batch = prepareBatch([...items, ...entries]); setItems(batch.items); setJunk(junk + batch.junk); setError(''); setFinished(false) } catch (e) { setError(fail(e)) }
  }
  async function drop(e) {
    e.preventDefault()
    try {
      const dt = e.dataTransfer
      const entries = Array.from(dt.items || []).map(i => i.webkitGetAsEntry?.()).filter(Boolean)
      await add(entries.length ? await collectEntries(entries) : Array.from(dt.files || []).map(file => ({ file, path: file.webkitRelativePath || file.name })))
    } catch (e) { setError(fail(e)) }
  }
  async function note() { setBusy(true); setError(''); try { await ctx.rest('/context', { method: 'POST', body: { project, title: title.trim(), body } }); await done(); close() } catch (e) { setError(fail(e)) } finally { setBusy(false) } }
  async function upload(retry = false) {
    if (busy) return
    setBusy(true); setError(''); cancelled.current = false
    const batch = items.map(i => ({ ...i }))
    const selected = retry ? batch.filter(i => i.status === 'failed') : batch.filter(i => i.status === 'pending')
    setProgress({ current: 0, total: selected.length })
    try { await uploadBatch(ctx, project, selected, policy, () => cancelled.current, () => { setItems([...batch]); setProgress({ current: selected.filter(i => !['pending', 'uploading'].includes(i.status)).length, total: selected.length }) }); await done(); setFinished(!batch.some(i => i.status === 'pending')) } catch (e) { setError(fail(e)) } finally { setBusy(false) }
  }
  const counts = Object.fromEntries(['created', 'renamed', 'overwritten', 'skipped', 'failed'].map(x => [x, items.filter(i => i.status === x).length]))
  const complete = progress.current
  const input = folder => jsx('input', { type: 'file', multiple: true, style: { display: 'none' }, ref: el => { (folder ? folderRef : filesRef).current = el; if (folder && el) el.setAttribute('webkitdirectory', '') }, disabled: busy, onChange: e => { void add(Array.from(e.target.files || []).map(file => ({ file, path: file.webkitRelativePath || file.name }))); e.target.value = '' } })
  const eligible = items.filter(i => i.status === 'pending'), groups = new Map()
  items.forEach((item, index) => { const group = item.path.includes('/') ? item.path.split('/')[0] : ''; if (!groups.has(group)) groups.set(group, []); groups.get(group).push({ item, index }) })
  return jsx(Modal, { title: 'Add context', close: () => { if (!busy) close() }, children: jsxs('div', { className: 'flex flex-col gap-3', children: [
    jsx(SegmentedControl, { value: tab, onChange: setTab, disabled: busy, options: [{ id: 'upload', label: 'Upload files' }, { id: 'note', label: 'Write a note' }] }),
    tab === 'note' ? jsxs('div', { className: 'flex flex-col gap-3', children: [field(title, setTitle, 'Note title'), area(body, setBody, 'Note text', { rows: 6 }), !title.trim() && small('Enter a title to add your note.'), error && small(error), button('Add note', note, { variant: 'default', disabled: busy || !title.trim() })] }) : jsxs('div', { className: 'flex flex-col gap-3', children: [
      input(false), input(true), jsxs('div', { onDragOver: e => { e.preventDefault(); setDragging(true) }, onDragLeave: () => setDragging(false), onDrop: e => { setDragging(false); if (busy) e.preventDefault(); else void drop(e) }, className: `rounded-lg border border-dashed ${border} p-5 text-center`, style: dragging ? { background: 'var(--ui-bg-secondary)' } : {}, children: [icon('cloud-upload'), jsx('div', { children: 'Drop files or folders here' }), button('Choose files', () => filesRef.current?.click(), { disabled: busy }), button('Choose folder', () => folderRef.current?.click(), { disabled: busy })] }),
      small(`${eligible.length} files · ${humanSize(eligible.reduce((n, i) => n + i.file.size, 0))} ready${items.filter(i => i.status === 'skipped' && i.reason === 'Exceeds 10 MiB').length ? ` · ${items.filter(i => i.status === 'skipped' && i.reason === 'Exceeds 10 MiB').length} too large (over 10 MiB)` : ''}${junk ? ` · ${junk} system files ignored` : ''}`),
      jsx('div', { style: { maxHeight: 280, overflowY: 'auto' }, children: Array.from(groups, ([group, list]) => jsxs('div', { children: [group && jsx('div', { className: 'font-medium text-sm', children: `${group} · ${list.length} files` }), ...list.map(({item: i, index}) => jsxs('div', { className: 'flex items-center gap-2 text-xs py-1', children: [jsx('span', { style: { color: i.status === 'failed' ? 'var(--destructive)' : i.status === 'skipped' ? 'var(--ui-text-warning, #b7791f)' : 'var(--ui-text-tertiary)' }, children: icon(i.status === 'failed' ? 'error' : i.status === 'skipped' ? 'warning' : i.status === 'pending' ? 'file' : 'check') }), jsx('span', { className: 'flex-1 break-all', children: `${group ? i.path.slice(group.length + 1) : i.path} · ${humanSize(i.file.size)} · ${{created:'done', overwritten:'replaced'}[i.status] || i.status}${i.reason ? ': ' + i.reason : ''}` }), button('×', () => setItems(items.filter((_, n) => n !== index)), { disabled: busy, 'aria-label': `Remove ${i.path}` })] }, index))] }, group)) }),
      jsxs('label', { children: ['If a file already exists: ', jsx('select', { value: policy, disabled: busy, onChange: e => setPolicy(e.target.value), children: [jsx('option', { value: 'rename', children: 'Keep both' }), jsx('option', { value: 'overwrite', children: 'Replace' }), jsx('option', { value: 'skip', children: 'Skip' })] })] }),
      busy && jsxs('div', { children: [small(`Uploading ${Math.min(complete + 1, progress.total)} of ${progress.total}…`), jsx('progress', { value: complete, max: progress.total || 1 })] }), finished && small(`Created ${counts.created} · Renamed ${counts.renamed} · Replaced ${counts.overwritten} · Skipped ${counts.skipped} · Failed ${counts.failed}${cancelled.current ? ' · Cancelled' : ''}`), error && small(error),
      jsxs('div', { className: 'sticky bottom-0 flex justify-end gap-2 bg-(--ui-bg-primary) py-3', children: [button(busy ? 'Stop' : 'Cancel', () => { if (busy) cancelled.current = true; else close() }, { variant: 'secondary' }), counts.failed > 0 && !busy && button('Retry failed', () => upload(true)), finished && !busy ? button('Done', close, { variant: 'default' }) : button(`Upload ${eligible.length} files`, () => upload(false), { variant: 'default', disabled: busy || !eligible.length })] })
    ] })
  ] }) })
}

function ScheduledRow({ job, action, remove }) {
  const next = job.next_run_at ? new Date(job.next_run_at).getTime() : NaN
  const relative = Number.isFinite(next) ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round((next - Date.now()) / 60000), 'minute') : ''
  return jsxs('div', { className: `border-b ${border} py-2 text-xs`, children: [jsx('div', { className: 'font-medium', children: job.name || job.job_id }), small(`${job.schedule_display || (typeof job.schedule === 'string' ? job.schedule : job.schedule?.display || job.schedule?.expr) || 'No schedule'} · ${job.enabled === false ? 'Paused' : 'Active'}${relative ? ` · Next run ${relative}` : ''}`), jsxs('div', { className: 'flex items-center gap-2', children: [button(job.enabled === false ? 'Resume' : 'Pause', () => action(job, job.enabled === false ? 'resume' : 'pause')), button('Remove', remove, { className: 'ml-auto text-(--destructive)' })] })] })
}
function ContextView({ ctx, project, name, file, close }) {
  const epoch = useGatewayActivationEpoch()
  const isText = file?.text ?? /\.(txt|md|markdown|json|yaml|yml|csv|tsv|xml|html|css|js|ts|py|sh|toml|ini|log|sql|rst)$/i.test(name)
  const data = useQuery({ queryKey: ['project-home', epoch, project, 'context-file', name], queryFn: () => ctx.rest('/context/file' + query(project) + '&path=' + enc(name)), enabled: isText })
  if (!isText) return jsx(Modal, { title: name.split('/').pop(), close, children: jsxs('div', { className: 'space-y-2 text-sm', children: [jsx('div', { children: `Name: ${name.split('/').pop()}` }), jsx('div', { children: `Folder: ${name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : 'context'}` }), jsx('div', { children: `Size: ${humanSize(file?.size)}` }), jsx('div', { children: `Modified: ${file?.mtime ? new Date(file.mtime * 1000).toLocaleString() : 'Unknown'}` }), jsx('p', { children: `Preview isn't available for this file type. The agent can still read it from context/${name}.` })] }) })
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
function ComposerProjectPicker({ pins }) {
  const cwd = useValue(host.state.cwd)
  const id = useValue(host.state.focusedStoredSessionId)
  const profile = useValue(host.state.profile)
  const epoch = useGatewayActivationEpoch()
  const [, refresh] = useState(0)
  useEffect(() => pins.subscribe(() => refresh(n => n + 1)), [])
  const list = useQuery({ queryKey: ['project-home', epoch, profile, 'projects'], queryFn: () => request('projects.list', {}), refetchInterval: 30000 })
  const projects = (list.data?.projects || []).filter(p => !p.archived && p.primary_path)
  const activity = useQuery({ queryKey: ['project-home', epoch, profile, 'activity', projects.map(p => p.id).join(',')], queryFn: async () => Object.fromEntries(await Promise.all(projects.map(async p => [p.id, sessionRows(await request('projects.project_sessions', { project_id: p.id })).filter(conversational)]))), refetchInterval: 30000, enabled: projects.length > 0 })
  const last = p => Math.max(0, ...(activity.data?.[p.id] || []).map(s => Number(s.last_active || s.started_at || 0))) || Number(p.created_at || 0)
  const matches = projects.flatMap(p => [p.primary_path, ...(p.folders || [])].map(f => ({ p, path: (typeof f === 'string' ? f : f?.path || '').replace(/\/+$/, '') }))).filter(x => x.path && (cwd === x.path || cwd?.startsWith(x.path + '/'))).sort((a, b) => b.path.length - a.path.length)
  const selected = matches[0]?.p
  const sorted = [...projects].sort((a, b) => Number(pins.has(b.id)) - Number(pins.has(a.id)) || last(b) - last(a))
  async function move(p) {
    const session_key = host.state.focusedStoredSessionId.get()
    try {
      const rows = session_key ? await request('session.list', { limit: 10000, profile: host.state.profile.get() }) : null
      if (session_key && rows?.sessions?.some(s => s.id === session_key)) await request('session.workspace.move', { session_key, cwd: p.primary_path })
      else await openProjectChat(p)
    } catch (e) { host.notify({ kind: 'error', message: `Move project: ${fail(e)}` }) }
  }
  return jsxs(DropdownMenu, { children: [jsx(DropdownMenuTrigger, { asChild: true, children: button(jsxs('span', { className: 'flex items-center gap-1', children: [icon('folder'), selected?.name || 'No project'] }), undefined, { 'aria-label': 'Choose project', className: 'h-7 px-2 text-xs' }) }), jsxs(DropdownMenuContent, { align: 'start', children: [...sorted.map(p => jsx(DropdownMenuItem, { onSelect: () => void move(p), children: p.name }, p.id)), jsx(DropdownMenuSeparator, {}), !id && small('Starts a chat in this project; unsent draft text may be lost.', 'px-2 py-1'), jsx(DropdownMenuItem, { onSelect: () => go(), children: 'Open Projects…' })] })] })
}
export default {
  id: 'project-home', name: 'Project Home', version: '0.5.0', defaultEnabled: false,
  register(ctx) {
    let board = {}, disposers = [], listeners = new Set(), known = [], retired = false, generation = 0
    const storageKey = () => `pinned-projects:${host.state.connectionId?.get() || 'local'}:${host.state.profile.get() || 'default'}`
    function sync(projects) {
      known = projects
      for (const dispose of disposers) dispose()
      disposers = projects.filter(p => board[p.id]?.pinned).map((p, i) => ctx.register({ id: `pin-${i}`, area: SIDEBAR_NAV_AREA, order: 101 + i, data: { path: `${BASE}?project=${enc(p.id)}`, label: p.name, codicon: 'project' } }))
    }
    function publish() { sync(known); for (const fn of listeners) fn() }
    const pins = { has: id => !!board[id]?.pinned, get: id => board[id] || {}, sync, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
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
    ctx.register({ id: 'composer-project', area: COMPOSER_AREAS.leading, render: () => jsx(ComposerProjectPicker, { pins }) })
    ctx.register({ id: 'page', area: ROUTES_AREA, data: { path: BASE }, render: () => jsx(Page, {}) })
    ctx.register({ id: 'nav', area: SIDEBAR_NAV_AREA, order: 100, data: { path: BASE, label: 'Projects', codicon: 'project' } })
    ctx.register({ id: 'open', area: PALETTE_AREA, data: { id: 'project-home.open', label: 'Open Projects', keywords: ['projects'], run: () => go() } })
    ctx.onDispose(() => { retired = true; stopProfile(); stopConnection(); for (const dispose of disposers) dispose(); listeners.clear() })
  }
}
