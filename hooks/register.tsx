// Flowmap: /flowmap opens a sidebar with two tabs.
//   Agents · the main loop, each subagent with its model, and their tool calls, live
//   Files  · the files Claude plans, reads and edits, grouped into architecture layers
//            (Client → API → Service → Domain → Data → Database), with the links between them,
//            the file being worked on now and the model working on it
// /flowmap web opens the same picture as a diagram in the browser, refreshed every 2 seconds.
// Claude declares the files it will touch through the plan_files tool, so they show before they exist.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FlowEdge, FlowFile, FlowNode } from '../types'
import { agentLines, base, cap, CODE_FILE, edgesOf, isAbs, keyOf, LAYERS, layerOf, mergeEdges, norm, rel, shortModel, toolLabel } from './model'
import { page } from './web'

const PANE = 'flowmap'
const PLAN_TOOL = 'mcp__flowmap__plan_files'
const MAX_FILES = 40
// Claude Code's own bookkeeping, not work worth a row.
const INTERNAL = new Set(['ToolSearch', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TodoWrite', 'SubagentHandback', PLAN_TOOL])

// Held by the host, so a hot reload keeps the picture.
const nodes = atom({ plugin: 'flowmap', key: 'nodes' } as const, [] as FlowNode[])
const files = atom({ plugin: 'flowmap', key: 'files' } as const, [] as FlowFile[])
const edges = atom({ plugin: 'flowmap', key: 'edges' } as const, [] as FlowEdge[])
const view = atom({ plugin: 'flowmap', key: 'view' } as const, 'files' as 'agents' | 'files')
const web = atom({ plugin: 'flowmap', key: 'web' } as const, null as string | null)
const now = atom({ plugin: 'flowmap', key: 'now' } as const, 0)

// Module scratch; a reload starts it over and it refills as files are touched again.
const texts = new Map<string, string>()
let root: string | undefined
let webPending = false

const GUIDE = `When a task will create or change two or more files, first call ${PLAN_TOOL} with every file you expect to create or modify (absolute or project-relative paths) and the links between them (from uses/calls/depends on to). Call it again when the plan changes. It only draws a live map for the user; it changes nothing.`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'flowmap', description: 'Live sidebar of agents and the files Claude plans and edits; /flowmap web opens the diagram in the browser', argumentHint: '[files|agents|web|clear]' }).catch(() => {})
    await $.tool
      .register({
        name: 'plan_files',
        isDeferred: false,
        description: 'Shows the user a live architecture map of the files you are about to create or modify and how they relate. Call before multi-file changes; call again when the plan changes. Has no effect on the code.',
        inputSchema: {
          type: 'object',
          properties: {
            files: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'Absolute or project-relative path' },
                  action: { type: 'string', enum: ['create', 'modify', 'delete'] },
                  layer: { type: 'string', enum: LAYERS.map(l => l.id), description: 'Optional; inferred from the path when left out' },
                  note: { type: 'string', description: 'A few words on what changes there' },
                },
                required: ['path', 'action'],
              },
            },
            relations: {
              type: 'array',
              items: {
                type: 'object',
                properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' } },
                required: ['from', 'to'],
              },
            },
          },
          required: ['files'],
        },
      })
      .catch(() => {})
    $.clock.every(1000, () => {
      void (async () => {
        if ((await read($, nodes)).some(n => n.status === 'running')) await update($, now, () => Date.now())
      })().catch(() => {})
    })
    return r
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (!e.tools.includes(PLAN_TOOL)) return r
    return { sections: [...r.sections, { id: 'flowmap:guide', text: GUIDE, scope: 'session' as const }] }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const model = await $.session.model().catch(() => undefined)
    const main: FlowNode = { id: 'main', parent: null, kind: 'main', label: `main · ${words(e.text, 46) || 'continuing'}`, family: 'main', model, status: 'running', start: Date.now() }
    // A background agent still running from the last turn carries over, with its open calls.
    await update($, nodes, list => {
      const agents = list.filter(n => n.kind === 'agent' && n.status === 'running').map(a => ({ ...a, parent: 'main' }))
      const ids = new Set(agents.map(a => a.id))
      return [main, ...agents, ...list.filter(n => n.kind === 'tool' && n.status === 'running' && ids.has(n.parent ?? ''))]
    })
    changed($)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId) {
      const agent: FlowNode = { id: r.agentId, parent: e.parentAgentId ?? 'main', kind: 'agent', label: e.description || e.subagentType, family: e.subagentType, model: r.model, status: 'running', start: Date.now() }
      await update($, nodes, list => cap([...list, agent])).catch(() => {})
      changed($)
    }
    return r
  })

  on('tool.call', { tool: PLAN_TOOL }, async ($, e) => {
    const n = await plan($, e as unknown as Record<string, unknown>).catch(() => ({ files: 0, links: 0 }))
    void $.ui.open({ id: PANE, title: 'Flowmap' }).catch(() => {})
    return { result: `Flowmap shows ${n.files} planned files and ${n.links} links to the user.` }
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Agent' || INTERNAL.has(e.tool)) return next(e)
    const args = e as unknown as Record<string, unknown>
    const id = e.tool_use_id
    const path = typeof args.file_path === 'string' && CODE_FILE.test(args.file_path) ? args.file_path : undefined
    const isWrite = e.tool === 'Edit' || e.tool === 'Write'
    const isFile = !!path && (isWrite || e.tool === 'Read')
    let existed = true
    // The map is a side show: nothing here may fail the real tool call.
    try {
      const { label, family } = toolLabel(e.tool, args)
      const list = await read($, nodes)
      const parent = e.agentId && list.some(n => n.id === e.agentId) ? e.agentId : 'main'
      const owner = list.find(n => n.id === parent)
      await update($, nodes, l => cap([...l, { id, parent, kind: 'tool', label, family, status: 'running', start: Date.now() }]))
      if (path && e.tool === 'Write') existed = await $.fs.exists(path).catch(() => true)
      if (isFile) await mark($, path!, { active: isWrite ? 'editing' : 'reading', by: owner?.kind === 'agent' ? owner.label : 'main', model: owner?.model })
      changed($)
    } catch {}

    let failed = true
    try {
      const r = await next(e)
      failed = r.deny !== undefined || r.isError === true
      return r
    } finally {
      try {
        await update($, nodes, l => l.map(n => (n.id === id ? { ...n, status: (failed ? 'failed' : 'done') as FlowNode['status'], end: Date.now() } : n)))
        if (isFile) await settle($, path!, failed ? undefined : isWrite ? (existed ? 'edited' : 'created') : 'read')
        changed($)
      } catch {}
    }
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const id = e.agentId ?? 'main'
    const failed = e.reason === 'error' || e.reason === 'aborted'
    const isMain = !e.agentId
    await update($, nodes, list => {
      const live = new Set(list.filter(n => n.kind === 'agent' && n.status === 'running' && n.id !== id).map(n => n.id))
      const close = (n: FlowNode) => n.id === id || (isMain && n.kind === 'tool' && !live.has(n.parent ?? ''))
      return list.map(n => (close(n) && n.status === 'running' ? { ...n, status: (failed ? 'failed' : 'done') as FlowNode['status'], end: Date.now() } : n))
    })
    if (isMain) await update($, files, list => list.map(f => (f.active ? { ...f, active: undefined } : f)))
    changed($)
    return r
  })

  on('command.run', { command: 'flowmap' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'clear') {
      await update($, files, () => [])
      await update($, edges, () => [])
      texts.clear()
      changed($)
      return { text: 'Flowmap cleared.' }
    }
    if (arg === 'web') return { text: await openWeb($) }
    if (arg === 'agents' || arg === 'files') await update($, view, () => arg)
    await $.ui.open({ id: PANE, title: 'Flowmap', focus: true })
    const fs = await read($, files)
    return { text: `Flowmap: ${fs.length} files, ${(await read($, nodes)).filter(n => n.kind === 'agent').length} agents. f: files · a: agents · b: browser · q: close` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    await read($, now) // ticks the durations while something runs
    const v = await read($, view)
    const rows = Math.max(6, (e.props.scroll?.bodyRows ?? 30) - 3)
    const head = (
      <Box flexDirection="row" gap={1}>
        <Button key="files" label="Files" hotkey="f" variant={v === 'files' ? 'primary' : undefined} onPress={() => update($, view, () => 'files')} />
        <Button key="agents" label="Agents" hotkey="a" variant={v === 'agents' ? 'primary' : undefined} onPress={() => update($, view, () => 'agents')} />
        <Button key="web" label="Browser" hotkey="b" onPress={() => void openWeb($).then(t => $.ui.toast(t))} />
        <Button key="close" label="Close" hotkey="q" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
      </Box>
    )

    if (v === 'agents') {
      const list = await read($, nodes)
      const ls = agentLines(list, Date.now())
      const agents = list.filter(n => n.kind === 'agent')
      return (
        <Box flexDirection="column">
          {head}
          <Text dimColor>{`${agents.length} agents (${agents.filter(a => a.status === 'running').length} running) · ${list.filter(n => n.kind === 'tool').length} tool calls`}</Text>
          {ls.length === 0 && <Text dimColor>Nothing yet. Start a task and watch it fill in.</Text>}
          {ls.slice(-rows + 1).map(l => (
            <Text wrap="truncate-end">
              <Text dimColor>{l.prefix}</Text>
              <Text color={l.status === 'running' ? 'yellow' : l.status === 'failed' ? 'red' : l.node.kind === 'tool' ? undefined : 'green'} bold={l.node.kind !== 'tool'} dimColor={l.status === 'done' && l.node.kind === 'tool'}>
                {l.text}
              </Text>
            </Text>
          ))}
        </Box>
      )
    }

    const fs = await read($, files)
    const es = await read($, edges)
    const live = fs.find(f => f.active)
    const lanes = LAYERS.filter(l => fs.some(f => f.layer === l.id))
    const byKey = new Map(fs.map(f => [f.key, f]))
    return (
      <Box flexDirection="column">
        {head}
        {live ? (
          <Text wrap="truncate-end">
            <Text color="yellow" bold>{live.active === 'editing' ? '✎ editing ' : '◉ reading '}</Text>
            <Text bold>{base(live.path)}</Text>
            <Text color="magenta">{`  ${shortModel(live.model) || 'model ?'}`}</Text>
            <Text dimColor>{` · ${live.by ?? 'main'}`}</Text>
          </Text>
        ) : (
          <Text dimColor>{fs.length ? 'Idle.' : 'No files yet. They show as Claude plans, reads and edits them.'}</Text>
        )}
        {lanes.map((l, i) => (
          <Box key={l.id} flexDirection="column">
            {i > 0 && <Text dimColor>{'   ▼'}</Text>}
            <Box flexDirection="column" borderStyle="round" borderColor={l.term} paddingX={1}>
              <Text color={l.term} bold>{l.name}</Text>
              {fs
                .filter(f => f.layer === l.id)
                .map(f => (
                  <Text wrap="truncate-end">
                    <Text color={f.active ? 'yellow' : f.status === 'created' ? 'green' : f.status === 'edited' ? 'cyan' : undefined} dimColor={f.status === 'read' || f.status === 'planned'} bold={!!f.active}>
                      {`${icon(f)} ${base(f.path)}`}
                    </Text>
                    <Text dimColor>{tag(f)}</Text>
                    {f.active ? <Text color="magenta">{`  ← ${shortModel(f.model)}`}</Text> : null}
                  </Text>
                ))}
            </Box>
          </Box>
        ))}
        {es.length > 0 && <Text bold>Links</Text>}
        {es.slice(0, 12).map(x => {
          const a = byKey.get(x.from)
          const b = byKey.get(x.to)
          const hot = !!(a?.active || b?.active)
          return a && b ? (
            <Text wrap="truncate-end" color={hot ? 'yellow' : undefined} dimColor={!hot}>
              {`${base(a.path)} ${x.planned ? '┄▶' : '──▶'} ${base(b.path)}${x.label ? `  (${x.label})` : ''}`}
            </Text>
          ) : null
        })}
        {es.length > 12 && <Text dimColor>{`… ${es.length - 12} more links in the browser view (b)`}</Text>}
      </Box>
    )
  })
}

const icon = (f: FlowFile) => (f.active === 'editing' ? '✎' : f.active === 'reading' ? '◉' : f.status === 'created' ? '+' : f.status === 'edited' ? '✓' : f.status === 'planned' ? '○' : '·')
const tag = (f: FlowFile) => (f.status === 'planned' ? `  ${f.action === 'create' ? 'new' : f.action ?? 'planned'}${f.note ? ` · ${f.note}` : ''}` : f.status === 'created' ? '  new' : '')

function words(text: string, max: number) {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.lastIndexOf(' ', max)
  return `${t.slice(0, cut > max * 0.5 ? cut : max)}…`
}

async function rootOf($: EngineInterface) {
  return (root ??= norm(await $.session.root().catch(() => '')))
}

async function resolve($: EngineInterface, p: string) {
  return isAbs(p) ? norm(p) : `${await rootOf($)}/${norm(p).replace(/^\.\//, '')}`
}

// Puts a file on the map (or updates it), keeping the list under the cap: reads go first.
async function upsert($: EngineInterface, path: string, patch: Partial<FlowFile>) {
  const key = keyOf(path)
  const shown = rel(path, await rootOf($))
  await update($, files, list => {
    const old = list.find(f => f.key === key)
    const next: FlowFile = { key, path: shown, layer: old?.layer ?? layerOf(path), status: 'read', ...old, ...patch, at: Date.now() }
    let out = [...list.filter(f => f.key !== key), next]
    while (out.length > MAX_FILES) {
      const drop = out.find(f => f.status === 'read' && !f.active) ?? out[0]!
      out = out.filter(f => f !== drop)
    }
    return out
  })
}

async function mark($: EngineInterface, path: string, patch: Pick<FlowFile, 'active' | 'by' | 'model'>) {
  await upsert($, path, patch)
}

// After the tool ran: the file's new status, its text for the links, and the links again.
async function settle($: EngineInterface, path: string, outcome: 'read' | 'edited' | 'created' | undefined) {
  const key = keyOf(path)
  const old = (await read($, files)).find(f => f.key === key)
  let status = old?.status ?? 'read'
  if (outcome === 'created') status = 'created'
  else if (outcome === 'edited' && status !== 'created') status = 'edited'
  else if (outcome === 'read' && !old) status = 'read'
  await upsert($, path, { active: undefined, status })
  if (!outcome) return
  const text = await $.fs.read(path).catch(() => '')
  if (typeof text === 'string' && text) texts.set(key, text.slice(0, 200_000))
  await relink($)
}

async function relink($: EngineInterface) {
  const found = edgesOf(await read($, files), texts)
  await update($, edges, old => mergeEdges(old, found))
}

// The plan_files tool: planned files replace the last plan's untouched ones.
async function plan($: EngineInterface, input: Record<string, unknown>) {
  const items = Array.isArray(input.files) ? (input.files as Record<string, unknown>[]) : []
  const rels = Array.isArray(input.relations) ? (input.relations as Record<string, unknown>[]) : []
  const ids = new Set<string>(LAYERS.map(l => l.id))
  const keys = new Set<string>()
  await update($, files, list => list.filter(f => f.status !== 'planned'))
  for (const it of items) {
    if (typeof it.path !== 'string' || !it.path) continue
    const path = await resolve($, it.path)
    keys.add(keyOf(path))
    const old = (await read($, files)).find(f => f.key === keyOf(path))
    const action = it.action === 'create' || it.action === 'delete' ? it.action : 'modify'
    await upsert($, path, {
      action,
      note: typeof it.note === 'string' ? it.note.slice(0, 80) : undefined,
      ...(typeof it.layer === 'string' && ids.has(it.layer) ? { layer: it.layer } : {}),
      ...(old && old.status !== 'read' ? {} : { status: 'planned' as const }),
    })
  }
  const planned: FlowEdge[] = []
  for (const r of rels) {
    if (typeof r.from !== 'string' || typeof r.to !== 'string') continue
    planned.push({ from: keyOf(await resolve($, r.from)), to: keyOf(await resolve($, r.to)), label: typeof r.label === 'string' ? r.label.slice(0, 40) : undefined, planned: true })
  }
  await update($, edges, old => mergeEdges(planned, old.filter(x => !x.planned)))
  changed($)
  return { files: keys.size, links: planned.length }
}

// Something on the map changed: refresh the browser page soon, if it was opened.
function changed($: EngineInterface) {
  if (webPending) return
  webPending = true
  $.clock.after(500, () => {
    webPending = false
    void writeWeb($).catch(() => {})
  })
}

async function writeWeb($: EngineInterface) {
  const path = await read($, web)
  if (!path) return
  const project = base(await rootOf($)) || 'project'
  await $.fs.write(path, page({ files: await read($, files), edges: await read($, edges), nodes: await read($, nodes), project }))
}

async function openWeb($: EngineInterface) {
  const tmp = norm((await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/$/, '')
  const path = `${tmp}/flowmap/flowmap.html`
  await update($, web, () => path)
  await writeWeb($)
  const isWin = /^[a-z]:\//i.test(path)
  const r = await $.process
    .run(isWin ? ['explorer.exe', path.replace(/\//g, '\\')] : ['open', path], { timeoutMs: 10_000 })
    .catch(() => undefined)
  // explorer.exe exits 1 even when it opened the page.
  return r ? `Flowmap opened in the browser: ${path}` : `Flowmap page written to ${path}; open it in a browser.`
}
