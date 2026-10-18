import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type $T = Parameters<TestBody>[0]
type OnT = Parameters<TestBody>[1]

const mountPane = ($: $T, surface: 'terminal' | 'desktop', props: object = {}) =>
  $.ui.mount({ plugin: 'live-view', surface, component: 'Pane', props: props as never, requestId: 'live-view' })

const SURFACES = ['terminal', 'desktop'] as const

/** Answers the engine's side of tools, turns and spawns so a test can drive them. */
const stubs = (on: OnT, opts: { failing?: string } = {}) => {
  let n = 0
  on('tool.call', async (_$, e) =>
    ((e as { tool: string }).tool === opts.failing
      ? { result: { stdout: '', stderr: 'boom', interrupted: false }, isError: true }
      : { result: { stdout: 'hi', stderr: '', interrupted: false } }) as never,
  )
  on('turn.start', async (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  on('agent.spawn', async () => ({ agentId: `a${++n}`, model: 'claude-haiku-5-5' }) as never)
  on('prompt.submit', async (_$, e) => e as never)
}

/** A typed prompt, then the main loop's start: what a person's message looks like to the mod. */
const startTurn = async ($: $T, text: string, turnId = 't1') => {
  await $.prompt.submit({ text } as never)
  await $.turn.start({ text, turnId } as never)
}
const endTurn = ($: $T, turnId = 't1') =>
  $.turn.complete({ answer: '', durationMs: 4200, isAborted: false, turnId, reason: 'answer' } as never)

test('the live flow shows the prompt, Main and each step with what it worked on', async ($, on) => {
  stubs(on)
  await startTurn($, 'fix the auth bug')
  await $.tool.call({ tool: 'Read', file_path: 'C:\\repo\\src\\auth.ts' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' } as never)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Text', text: /This chat/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Live/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /fix the auth bug/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Main ·/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Read · auth\.ts/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Bash · Run the tests/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /working/ })).toBeDefined()
    await ui.unmount()
  }
})

test('repeated calls of one tool fold into one step', async ($, on) => {
  stubs(on)
  await startTurn($, 'look')
  for (const f of ['a.ts', 'b.ts', 'c.ts']) await $.tool.call({ tool: 'Read', file_path: f } as never)

  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /Read ×3 · c\.ts/ })).toBeDefined()
  await ui.unmount()
})

test('a failed tool call is marked failed', async ($, on) => {
  stubs(on, { failing: 'Bash' })
  await startTurn($, 'run it')
  await $.tool.call({ tool: 'Bash', command: 'false' } as never)

  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /✗ Bash/ })).toBeDefined()
  await ui.unmount()
})

test('first subagent spawn opens the pane on its own', async ($, on) => {
  const opened: string[] = []
  on('ui.open', async (_$, e) => {
    opened.push((e as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  on('agent.spawn', async () => ({ agentId: 'a1', model: 'claude-haiku-5-5' }) as never)
  await $.agent.spawn({ subagentType: 'Explore', description: 'look', prompt: 'x' } as never)
  expect(opened).toContain('live-view')
})

test('a subagent tool call shows inside its box, not in the main flow', async ($, on) => {
  stubs(on)
  await startTurn($, 'explore')
  await $.tool.call({ tool: 'Agent', description: 'look around', tool_use_id: 'call-1' } as never)
  await $.agent.spawn({ subagentType: 'Explore', description: 'look around', prompt: 'x', tool_use_id: 'call-1' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'autoOpen', agentId: 'a1' } as never)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface, { bodyColumns: 90 })
    expect(await ui.find({ type: 'Text', text: /↳ Grep · "autoOpen"/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 tool/ })).toBeDefined()
    // the subagent's call is not a main-chat step
    expect(await ui.find({ type: 'Text', text: /^✓ Grep/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('agents spawned by parallel Agent calls fan out at that step, as boxes when wide and lines when narrow', async ($, on) => {
  stubs(on)
  await startTurn($, 'three at once')
  for (const task of ['hooks', 'tests', 'types']) {
    await $.tool.call({ tool: 'Agent', description: task, tool_use_id: `call-${task}` } as never)
    await $.agent.spawn({ subagentType: 'Explore', description: task, prompt: 'x', tool_use_id: `call-${task}` } as never)
  }

  for (const surface of SURFACES) {
    const wide = await mountPane($, surface, { bodyColumns: 90 })
    expect(await wide.find({ type: 'Text', text: /Delegate to 3 agents/ })).toBeDefined()
    expect(await wide.find({ type: 'Text', text: /3 running/ })).toBeDefined()
    await wide.unmount()

    const narrow = await mountPane($, surface, { bodyColumns: 40 })
    expect(await narrow.find({ type: 'Text', text: /Delegate to 3 agents/ })).toBeDefined()
    expect(await narrow.find({ type: 'Text', text: /Explore · .*hooks/ })).toBeDefined()
    await narrow.unmount()
  }
})

test('a finished turn shows answered and moves to earlier turns when the next starts', async ($, on) => {
  stubs(on)
  await startTurn($, 'first ask', 't1')
  await $.tool.call({ tool: 'Read', file_path: 'a.ts' } as never)
  await endTurn($, 't1')

  let ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /✓ answered/ })).toBeDefined()
  await ui.unmount()

  await startTurn($, 'second ask', 't2')
  ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /second ask/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Earlier turns/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 · first ask · 1 call/ })).toBeDefined()
  await ui.unmount()
})

test('a long turn shows its last 8 steps and counts the rest', async ($, on) => {
  stubs(on)
  await startTurn($, 'busy')
  const names = ['Bash', 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'Skill', 'Read']
  for (const tool of names) await $.tool.call({ tool, command: 'x' } as never)

  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /2 earlier steps/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓ Skill/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓ Bash/ })).toBeUndefined()
  await ui.unmount()
})

test('a long chat keeps drawing its latest turn (history is capped)', async ($, on) => {
  stubs(on)
  for (let i = 1; i <= 40; i++) {
    await startTurn($, `ask ${i}`, `t${i}`)
    for (let j = 0; j < 8; j++) await $.tool.call({ tool: 'Read', file_path: `f${j}.ts` } as never)
    await endTurn($, `t${i}`)
  }

  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /turn 40/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Read ×8/ })).toBeDefined()
  // 40 turns x 8 calls: the list keeps the last 200, the count keeps them all
  expect(await ui.find({ type: 'Text', text: /320 tool calls/ })).toBeDefined()
  await ui.unmount()
})

test('agents no main-chat Agent call claims (a Workflow, a subagent) still draw', async ($, on) => {
  stubs(on)
  await startTurn($, 'run the workflow')
  await $.tool.call({ tool: 'Workflow', script: 'x' } as never)
  await $.agent.spawn({ subagentType: 'general-purpose', description: 'review bugs', prompt: 'x', tool_use_id: 'wf-1' } as never)
  await $.agent.spawn({ subagentType: 'general-purpose', description: 'review perf', prompt: 'x', tool_use_id: 'wf-2' } as never)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface, { bodyColumns: 90 })
    expect(await ui.find({ type: 'Text', text: /Workflow/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Delegate to 2 agents/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /review perf/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a background agent waking the chat continues the turn instead of starting a new one', async ($, on) => {
  stubs(on)
  await startTurn($, 'explore in the background', 't1')
  await $.tool.call({ tool: 'Agent', description: 'look', tool_use_id: 'call-1' } as never)
  await $.agent.spawn({ subagentType: 'Explore', description: 'look', prompt: 'x', tool_use_id: 'call-1' } as never)
  await endTurn($, 't1')
  // the notification wakes the main loop: no typed prompt before it
  await $.turn.start({ text: '[SYSTEM NOTIFICATION] agent finished', turnId: 't2' } as never)

  const ui = await mountPane($, 'terminal', { bodyColumns: 90 })
  expect(await ui.find({ type: 'Text', text: /explore in the background/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /SYSTEM NOTIFICATION/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Earlier turns/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Delegate to 1 agent/ })).toBeDefined()
  await ui.unmount()
})

test('a slash command or meta prompt does not start a turn', async ($, on) => {
  stubs(on)
  await startTurn($, 'real ask', 't1')
  await endTurn($, 't1')
  await $.prompt.submit({ text: '/live-view', command: { name: 'live-view' } } as never)
  await $.prompt.submit({ text: 'injected', isMeta: true } as never)
  await $.turn.start({ text: '', turnId: 't2' } as never)

  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /real ask/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /turn 1/ })).toBeDefined()
  await ui.unmount()
})

test('a task-notification prompt without isMeta does not become the You box', async ($, on) => {
  stubs(on)
  await startTurn($, 'real ask', 't1')
  await endTurn($, 't1')
  await $.prompt.submit({ text: '<task-notification> <task-id>abc</task-id>' } as never)
  await $.turn.start({ text: '', turnId: 't2' } as never)

  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /task-notification/ })).toBeUndefined()
  await ui.unmount()
})

test('the pane stays closed on a plain tool call outside the Code folder', async ($, on) => {
  const opened: string[] = []
  on('ui.open', async (_$, e) => {
    opened.push((e as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  on('tool.call', async () => ({ result: { stdout: 'hi', stderr: '', interrupted: false } }) as never)
  await $.tool.call({ tool: 'Bash', command: 'echo hi' } as never)
  expect(opened).not.toContain('live-view')
})

test('hidden tools (SubagentHandback, update_plan) never show', async ($, on) => {
  stubs(on)
  await startTurn($, 'quiet')
  await $.tool.call({ tool: 'SubagentHandback', command: 'x' } as never)
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: [] } as never)

  const ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /SubagentHandback/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /update_plan/ })).toBeUndefined()
  await ui.unmount()
})

test('with nothing yet the pane shows its empty states', async $ => {
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Text', text: /Waiting for the first prompt/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /None yet/ })).toBeDefined()
    await ui.unmount()
  }
})

const startIn = async ($: $T, on: OnT, cwd: string) => {
  const opened: string[] = []
  on('ui.open', async (_$, e) => {
    opened.push((e as { id: string }).id)
    return { value: { isPlaced: true } } as never
  })
  on('command.register', async () => ({ value: {} }) as never)
  on('session.start', async (_$, e) => e as never)
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true } as never)

  return opened
}

test('a chat started under a Code folder opens the pane', async ($, on) => {
  expect(await startIn($, on, 'C:\\Users\\dev\\Code\\some-project')).toContain('live-view')
})

test('a chat started elsewhere keeps the pane closed', async ($, on) => {
  expect(await startIn($, on, 'C:\\Users\\dev\\Documents')).not.toContain('live-view')
})

test('a sibling folder named CodeOther keeps the pane closed', async ($, on) => {
  expect(await startIn($, on, 'C:\\Users\\dev\\CodeOther\\x')).not.toContain('live-view')
})

test('a failed step shows why it failed', async ($, on) => {
  stubs(on, { failing: 'Bash' })
  await startTurn($, 'run it')
  await $.tool.call({ tool: 'Bash', command: 'false' } as never)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Text', text: /↳ boom/ })).toBeDefined()
    await ui.unmount()
  }
})

test('files touched this turn are counted, changed ones named', async ($, on) => {
  stubs(on)
  await startTurn($, 'edit things')
  for (const f of ['a.ts', 'b.ts', 'a.ts']) await $.tool.call({ tool: 'Read', file_path: `/repo/${f}` } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/repo/new.ts' } as never)

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Text', text: /Files · 2 read · 2 changed \(a\.ts, new\.ts\)/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the Main box says what it is doing now, and the answer box splits tool and thinking time', async ($, on) => {
  stubs(on)
  await startTurn($, 'think')

  let ui = await mountPane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /↳ thinking/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: 'Read', file_path: 'a.ts' } as never)
  await endTurn($)
  ui = await mountPane($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /tools .* · thinking / })).toBeDefined()
  await ui.unmount()
})
