// One row of the Agents tab: the main loop, a subagent, or one tool call.
export type FlowNode = {
  id: string
  parent: string | null
  kind: 'main' | 'agent' | 'tool'
  label: string
  family: string // tools: 'bash', 'edit', 'read', 'search', 'mcp:<server>', ...
  model?: string // main and agents: what they run on
  status: 'running' | 'done' | 'failed'
  start: number
  end?: number
}

// One file on the Files map.
export type FlowFile = {
  key: string // lower-cased, forward slashes: the identity
  path: string // as shown, relative to the project root when under it
  layer: string // see LAYERS in hooks/model.ts
  status: 'planned' | 'read' | 'edited' | 'created'
  action?: 'create' | 'modify' | 'delete' // what the plan said
  note?: string
  active?: 'reading' | 'editing' // a tool is on it right now
  by?: string // who touched it last: 'main' or an agent's label
  model?: string // the model that touched it last
  at: number
}

export type FlowEdge = { from: string; to: string; label?: string; planned?: boolean }

// One assumption Claude made while working, declared through the note_assumptions tool.
export type FlowAssumption = {
  key: string // lower-cased, whitespace-collapsed text: the identity
  text: string // what was assumed
  why?: string // what it rests on, or what would change if it's wrong
  confidence: 'low' | 'medium' | 'high'
  files?: string[] // paths it bears on, as shown on the map
  by: string // 'main' or an agent's label
  model?: string
  turn: string // the prompt it was made under, shortened
  count: number // how many times it was noted
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    flowmap: {
      nodes: FlowNode[]
      files: FlowFile[]
      edges: FlowEdge[]
      assumptions: FlowAssumption[]
      view: 'agents' | 'files' | 'assumptions'
      web: string | null // the companion page's path once opened
      now: number
    }
  }
}
