import { describe, expect, mock, test } from 'claude-code/testing'

import { edgesOf, layerOf, mergeAssumptions, shortModel } from '../hooks/model'

const PANE = { component: 'Pane', requestId: 'flowmap', props: { title: 'Flowmap', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 60 } } }

const SOURCE: Record<string, string> = {
  'D:/repo/src/Api/Controllers/OrderController.cs': 'public class OrderController { OrderService s; }',
  'D:/repo/src/Infrastructure/Orders/OrderService.cs': 'class OrderService { IOrderSource src; Order i; }',
}

// Stands for the engine beneath the mod.
function engine(on: any) {
  const writes: Record<string, string> = {}
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('session.root', () => ({ value: 'D:\\repo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  mock.clock(on)
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag1' }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('fs.read', (_$: any, e: any) => ({ value: SOURCE[e.path.replace(/\\/g, '/')] ?? '' }))
  on('fs.write', (_$: any, e: any) => ((writes[e.path] = e.text), { value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('env.get', () => ({ value: 'C:\\Temp' }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  return { writes }
}

describe('flowmap', () => {
  test('layers follow the request flow', () => {
    expect(layerOf('D:\\repo\\src\\Api\\Controllers\\OrderController.cs')).toBe('api')
    expect(layerOf('src/Infrastructure/Orders/OrderSource.cs')).toBe('data')
    expect(layerOf('src/Core/Orders/IOrderService.cs')).toBe('service')
    expect(layerOf('src/Core/Orders/Domain/Order.cs')).toBe('domain')
    expect(layerOf('src/Test/Orders/OrderServiceTest.cs')).toBe('tests')
    expect(layerOf('docs/specs/031-Orders/spec.md')).toBe('docs')
    expect(layerOf('src/Infrastructure/Migrations/20260101_Orders.cs')).toBe('database')
    expect(layerOf('client-app-fe/src/pages/Orders.tsx')).toBe('client')
    expect(shortModel('claude-opus-5-5')).toBe('opus 5.5')
  })

  test('a file that names another type links to it', () => {
    const f = (key: string, path: string) => ({ key, path, layer: 'other', status: 'read' as const, at: 0 })
    const files = [f('a', 'A/OrderController.cs'), f('b', 'B/OrderService.cs'), f('c', 'C/Other.cs')]
    const texts = new Map([['a', 'new OrderService()'], ['c', 'nothing here']])
    expect(edgesOf(files, texts)).toEqual([{ from: 'a', to: 'b' }])
  })

  test('an assumption noted twice is one, counted; the cap drops sure ones first', () => {
    const a = (text: string, confidence: 'low' | 'medium' | 'high', files?: string[]) => ({ key: text.toLowerCase(), text, confidence, files, by: 'main', turn: 't', count: 1, at: 0 })
    const once = mergeAssumptions([], [a('Uses EF Core', 'medium', ['A.cs'])])
    const twice = mergeAssumptions(once, [a('uses EF Core', 'high', ['B.cs'])])
    expect(twice).toHaveLength(1)
    expect(twice[0]).toMatchObject({ text: 'Uses EF Core', confidence: 'high', count: 2, files: ['A.cs', 'B.cs'] })
    const capped = mergeAssumptions([a('one', 'low'), a('two', 'high')], [a('three', 'medium')], 2)
    expect(capped.map(x => x.text)).toEqual(['one', 'three'])
  })

  test('a plan, an edit and an agent show in the sidebar and the browser page', async ($, on) => {
    const { writes } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'D:\\repo' } as any)
    await $.turn.start({ text: 'add the orders API', turnId: 't1' } as any)
    await $.tool.call({
      tool: 'mcp__flowmap__plan_files',
      tool_use_id: 'p1',
      files: [
        { path: 'src/Api/Controllers/OrderController.cs', action: 'create', note: 'GET /orders' },
        { path: 'src/Infrastructure/Orders/OrderService.cs', action: 'modify' },
      ],
      relations: [{ from: 'src/Api/Controllers/OrderController.cs', to: 'src/Infrastructure/Orders/OrderService.cs', label: 'calls' }],
    } as any)

    const pane = await $.ui.mount({ plugin: 'flowmap', surface: 'terminal', ...PANE } as any)
    expect(await pane.find({ type: 'Text', text: /API \/ Controller/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /○ OrderController\.cs/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /OrderController\.cs ┄▶ OrderService\.cs/ })).toBeDefined()

    await $.agent.spawn({ prompt: 'x', description: 'write controller', subagentType: 'general-purpose', parentModel: 'claude-opus-5-5', tool_use_id: 'a1' } as any)
    await $.tool.call({ tool: 'Write', tool_use_id: 'w1', agentId: 'ag1', file_path: 'D:\\repo\\src\\Api\\Controllers\\OrderController.cs', content: 'x' } as any)
    expect(await pane.find({ type: 'Text', text: /\+ OrderController\.cs/ })).toBeDefined() // created

    await $.command.run({ command: 'flowmap', args: 'agents' } as any)
    expect(await pane.find({ type: 'Text', text: /● write controller .* haiku 5\.5/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /◆ main · add the orders API .* opus 5\.5/ })).toBeDefined()

    await $.tool.call({
      tool: 'mcp__flowmap__note_assumptions',
      tool_use_id: 'n1',
      agentId: 'ag1',
      assumptions: [
        { text: 'Orders are paged 20 at a time', confidence: 'low', why: 'No page size in the spec', files: ['D:\\repo\\src\\Api\\Controllers\\OrderController.cs'] },
        { text: 'The API uses the existing auth policy', confidence: 'high' },
      ],
    } as any)
    await $.command.run({ command: 'flowmap', args: 'assumptions' } as any)
    expect(await pane.find({ type: 'Text', text: /2 assumptions · 1 not high confidence/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Orders are paged 20 at a time/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /No page size in the spec · OrderController\.cs · write controller · haiku 5\.5/ })).toBeDefined()

    await $.command.run({ command: 'flowmap', args: 'web' } as any)
    const html = Object.values(writes).at(-1) ?? ''
    expect(html).toContain('OrderController.cs')
    expect(html).toContain('API / Controller')
    expect(html).toContain('id="zf"') // the Fit control of the pan/zoom canvas
    expect(html).toContain('href="#assumptions"')
    expect(html).toContain('<div class="as low">')
    expect(html).toContain('Orders are paged 20 at a time')
    expect(html).toContain('add the orders API') // grouped under the prompt
    expect(html).not.toContain('${') // no template left unfilled in the page's script
    await pane.unmount()
  })
})
