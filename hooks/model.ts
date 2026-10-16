// Pure logic: which architecture layer a file sits in, how files relate, the agent tree.
import type { FlowEdge, FlowFile, FlowNode } from '../types'

// Left to right as a request flows, like the classic Client → Controller → Service → Model → DB picture.
// `term` is the terminal color, `web` the page's.
export const LAYERS = [
  { id: 'client', name: 'Client / UI', term: 'green', web: '#7ccf6b' },
  { id: 'api', name: 'API / Controller', term: 'cyan', web: '#7fb8e6' },
  { id: 'service', name: 'Service', term: 'yellow', web: '#f1cd5b' },
  { id: 'domain', name: 'Domain / Model', term: 'magenta', web: '#f19a9a' },
  { id: 'data', name: 'Data / Repository', term: 'blue', web: '#3fa58f' },
  { id: 'database', name: 'Database', term: 'blueBright', web: '#4f9fb0' },
  { id: 'tests', name: 'Tests', term: 'white', web: '#b59cf0' },
  { id: 'docs', name: 'Docs', term: 'gray', web: '#a3a3a3' },
  { id: 'other', name: 'Other', term: 'gray', web: '#8c8c8c' },
] as const

export const CODE_FILE = /\.(cs|csproj|tsx?|jsx?|mjs|vue|svelte|razor|cshtml|py|go|java|kt|rs|rb|php|css|scss|html|md|json|ya?ml|sql|sh|ps1)$/i

export const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/')
export const keyOf = (p: string) => norm(p).toLowerCase()
export const isAbs = (p: string) => /^([a-z]:)?\//i.test(norm(p))
export const base = (p: string) => norm(p).split('/').pop() ?? p

// The path as shown: relative to the root when under it.
export function rel(path: string, root: string) {
  const p = norm(path)
  const r = norm(root).replace(/\/$/, '')
  return r && p.toLowerCase().startsWith(`${r.toLowerCase()}/`) ? p.slice(r.length + 1) : p
}

// First match wins, so a test of a controller is a test and a migration is the database.
export function layerOf(path: string): string {
  const p = `/${keyOf(path)}`
  const name = base(p)
  if (/\/docs?\//.test(p) || /\.mdx?$/.test(name)) return 'docs'
  if (/\/tests?\/|\.tests?\/|tests?\.(cs|ts|tsx|js)$|\.(test|spec)\.[jt]sx?$/.test(p)) return 'tests'
  if (/\/migrations?\/|\.sql$/.test(p)) return 'database'
  if (/repositor|dbcontext|\/infrastructure\/|\/persistence\/|\/data\//.test(p)) return 'data'
  if (/controller|\/api\/|endpoint|hub\.cs$/.test(p)) return 'api'
  if (/\.(tsx|jsx|vue|svelte|razor|cshtml|css|scss|html)$|\/(views|pages|components|wwwroot|client)\//.test(p)) return 'client'
  if (/service|handler|manager|\/application\/|loader|source\.|rule\.|workflow|job\.cs$/.test(p)) return 'service'
  if (/\/(domain|models?|entities|dtos?|core)\/|dto\.|entity\./.test(p)) return 'domain'
  return 'other'
}

// The type name a file declares by convention (Foo.cs → Foo, foo.service.ts → foo).
const typeName = (path: string) => base(path).replace(/\..*$/, '')
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A → B when A's text names B's type (or B's file, for imports). Names under 4 letters are noise.
export function edgesOf(files: FlowFile[], texts: Map<string, string>): FlowEdge[] {
  const out: FlowEdge[] = []
  const named = files.map(f => ({ f, re: typeName(f.path).length >= 4 ? new RegExp(`\\b${escape(typeName(f.path))}\\b`) : null }))
  for (const a of files) {
    const text = texts.get(a.key)
    if (!text) continue
    for (const { f: b, re } of named) if (b.key !== a.key && re?.test(text)) out.push({ from: a.key, to: b.key })
  }
  return out
}

// Text edges replace the old text edges; planned edges stay until a new plan.
export function mergeEdges(old: FlowEdge[], found: FlowEdge[]): FlowEdge[] {
  const planned = old.filter(e => e.planned)
  const seen = new Set(planned.map(e => `${e.from}>${e.to}`))
  return [...planned, ...found.filter(e => !seen.has(`${e.from}>${e.to}`))]
}

// A short label and a family for one tool call.
export function toolLabel(tool: string, a: Record<string, unknown>): { label: string; family: string } {
  const s = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '')
  if (tool === 'Bash' || tool === 'PowerShell') return { label: s('description') || s('command').slice(0, 60), family: 'shell' }
  if (tool === 'Edit' || tool === 'Write') return { label: base(s('file_path')), family: 'edit' }
  if (tool === 'Read') return { label: base(s('file_path')), family: 'read' }
  if (tool === 'Grep' || tool === 'Glob') return { label: s('pattern').slice(0, 40), family: 'search' }
  if (tool.startsWith('mcp__')) {
    const [, server = '', action = ''] = tool.split('__')
    return { label: action, family: `mcp:${server.replace(/^(plugin_|claude_ai_)/, '').replace(/_.*$/, '')}` }
  }
  return { label: tool, family: tool.toLowerCase() }
}

// claude-opus-5-5 → opus 5.5; anything else as given.
export function shortModel(m?: string) {
  if (!m) return ''
  const hit = /(opus|sonnet|haiku|fable)[-_]?(\d+)(?:[-_.](\d+))?/i.exec(m)
  return hit ? `${hit[1]!.toLowerCase()} ${hit[2]}${hit[3] && hit[3].length < 3 ? `.${hit[3]}` : ''}` : m
}

export function took(n: Pick<FlowNode, 'start' | 'end'>, at = Date.now()) {
  const s = Math.max(0, ((n.end ?? at) - n.start) / 1000)
  if (s < 10) return `${s.toFixed(1)}s`
  if (s < 60) return `${Math.round(s)}s`
  return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`
}

export type Line = { prefix: string; node: FlowNode; text: string; status: FlowNode['status'] }

const ICON: Record<string, string> = { shell: '$', edit: '✎', read: '◉', search: '⌕' }

// Depth-first tree lines; a run of one tool family under one parent folds into one line.
export function agentLines(nodes: FlowNode[], at = Date.now()): Line[] {
  const kids = new Map<string | null, FlowNode[]>()
  for (const n of nodes) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n])
  const out: Line[] = []
  const walk = (parent: string | null, prefix: string) => {
    const groups: FlowNode[][] = []
    for (const n of kids.get(parent) ?? []) {
      const last = groups.at(-1)
      if (last && n.kind === 'tool' && last[0]!.kind === 'tool' && last[0]!.family === n.family) last.push(n)
      else groups.push([n])
    }
    groups.forEach((g, i) => {
      const isLast = i === groups.length - 1
      const n = g[0]!
      const branch = parent === null ? '' : isLast ? '└─ ' : '├─ '
      const status = g.some(x => x.status === 'running') ? 'running' : g.some(x => x.status === 'failed') ? 'failed' : 'done'
      let text: string
      if (n.kind === 'tool') {
        const acts = g.map(x => x.label)
        const shown = acts.length > 4 ? [...acts.slice(0, 3), '…', acts.at(-1)] : acts
        const end = status === 'running' ? undefined : Math.max(...g.map(x => x.end ?? x.start))
        text = `${ICON[n.family] ?? '·'} ${n.family.replace(/^mcp:/, '')}: ${shown.join(' → ')}${g.length > 1 ? `  ×${g.length}` : ''}  ${took({ start: Math.min(...g.map(x => x.start)), end }, at)}`
      } else {
        const tools = nodes.filter(x => x.parent === n.id && x.kind === 'tool').length
        const model = shortModel(n.model)
        text = `${n.kind === 'main' ? '◆' : '●'} ${n.label}  ${took(n, at)}${n.kind === 'agent' ? ` · ${tools} tools` : ''}${model ? ` · ${model}` : ''}`
      }
      out.push({ prefix: prefix + branch, node: n, text, status })
      if (n.kind !== 'tool') walk(n.id, parent === null ? '' : prefix + (isLast ? '   ' : '│  '))
    })
  }
  walk(null, '')
  return out
}

// Keeps main and agents, drops the oldest tool calls past the cap.
export function cap(list: FlowNode[], max = 300) {
  if (list.length <= max) return list
  const tools = list.filter(n => n.kind === 'tool')
  const keep = new Set(tools.slice(-Math.max(0, max - (list.length - tools.length))))
  return list.filter(n => n.kind !== 'tool' || keep.has(n))
}
