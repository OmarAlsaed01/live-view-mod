import { atom, read, update } from 'claude-code'
import type { Register, SessionUsage } from 'claude-code'

import type { AdvisorStats, AgentItem, ModelTotals, SessionNumbers, ToolItem, TurnItem } from '../types'

const PANE = 'live-view'
const tools = atom({ plugin: 'live-view', key: 'tools' } as const, [] as ToolItem[])
const agents = atom({ plugin: 'live-view', key: 'agents' } as const, [] as AgentItem[])
const turns = atom({ plugin: 'live-view', key: 'turns' } as const, [] as TurnItem[])
const clock = atom({ plugin: 'live-view', key: 'clock' } as const, 0)
const callCount = atom({ plugin: 'live-view', key: 'callCount' } as const, 0)
const model = atom({ plugin: 'live-view', key: 'model' } as const, '')
const isWorking = atom({ plugin: 'live-view', key: 'isWorking' } as const, false)
const models = atom({ plugin: 'live-view', key: 'models' } as const, {} as Record<string, ModelTotals>)
const session = atom({ plugin: 'live-view', key: 'session' } as const, {} as SessionNumbers)
const advisor = atom({ plugin: 'live-view', key: 'advisor' } as const, { calls: 0 } as AdvisorStats)

const MAX_TOOLS = 200
const MAX_AGENTS = 60
const MAX_TURNS = 30
const SHOWN_STEPS = 8
const SHOWN_TURNS = 3
const HIDDEN_TOOLS = new Set(['SubagentHandback', 'update_plan'])
// Darker than the terminal pane's default so it blends with a black terminal; the desktop surface keeps its own background.
const TERMINAL_BG = '#0c0c0c'
const BAR_W = 12

type Ctx = Parameters<typeof update>[0]

// Warm palette on purpose: reds and ambers for the models, green only for "done".
const COLORS: Record<string, string> = { Opus: '#e0533a', Sonnet: '#e8962a', Haiku: '#f0c84b' }
const DONE = '#3fb950'
const DIM_RED = '#c02838'
const RUNNING = '#e0533a'

/** claude-sonnet-5-5 -> Sonnet 5.5; an alias like haiku -> Haiku. */
const pretty = (id: string): string => {
  const m = /^(?:claude-)?([a-z]+)(?:-(\d+)(?:-(\d+))?)?/.exec(id)
  if (!m || !m[1]) return id || '…'
  const name = m[1].charAt(0).toUpperCase() + m[1].slice(1)

  return m[2] ? `${name} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : name
}

const colorOf = (id: string): string | undefined => COLORS[pretty(id).split(' ')[0] ?? '']

/** mcp__ccd_turn__wrap_up -> wrap_up. */
const toolName = (raw: string): string => (raw.startsWith('mcp__') ? (raw.split('__').pop() ?? raw) : raw)

/** 1234 -> 1.2k, 3400000 -> 3.4M. */
const fmt = (n: number): string => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`

  return String(Math.round(n))
}

/** 4200 -> 4.2s, 72000 -> 1m 12s. */
const dur = (ms: number): string => {
  const s = Math.max(0, ms) / 1000
  if (s < 10) return `${s.toFixed(1)}s`
  if (s < 60) return `${Math.round(s)}s`

  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

const clip = (text: string, max = 44): string => {
  const one = text.replace(/\s+/g, ' ').trim()

  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

/** What a call worked on, from its own arguments: a file name, a command's description, a pattern. */
const detailOf = (tool: string, e: unknown): string | undefined => {
  const args = e as Record<string, unknown>
  const str = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : undefined)
  const base = (path?: string) => path?.split(/[\\/]/).pop()
  const found = (() => {
    switch (tool) {
      case 'Read':
      case 'Edit':
      case 'Write':
        return base(str('file_path'))
      case 'NotebookEdit':
        return base(str('notebook_path'))
      case 'Bash':
      case 'PowerShell':
        return str('description') ?? str('command')
      case 'Grep':
      case 'Glob':
        return str('pattern') && `"${str('pattern')}"`
      case 'Agent':
        return str('description')
      case 'WebSearch':
        return str('query')
      case 'WebFetch':
        return str('url')?.replace(/^https?:\/\//, '').split('/')[0]
      case 'Skill':
        return str('skill')
      default:
        return str('description')
    }
  })()

  return found ? clip(found) : undefined
}

/** The file a Read/Edit/Write/NotebookEdit call works on, in full (used only to count distinct files). */
const pathOf = (tool: string, e: unknown): string | undefined => {
  if (tool !== 'Read' && tool !== 'Edit' && tool !== 'Write' && tool !== 'NotebookEdit') return undefined
  const args = e as Record<string, unknown>
  const raw = tool === 'NotebookEdit' ? args.notebook_path : args.file_path

  return typeof raw === 'string' && raw ? raw : undefined
}

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/** Why a call failed, from whatever the engine gave back: a denial, the tool's stderr or text, or the thrown error. */
const errorOf = (ran: unknown, err?: unknown): string | undefined => {
  const pick = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined
    const first = v
      .split(/\r?\n/)
      .map(l => l.trim())
      .find(Boolean)

    return first ? clip(first, 70) : undefined
  }
  if (err !== undefined) return pick(err instanceof Error ? err.message : err)
  const r = ran as { deny?: unknown; text?: unknown; result?: unknown } | null
  const res = r?.result as { stderr?: unknown; error?: unknown } | string | undefined
  if (typeof r?.deny === 'string') return pick(`denied: ${r.deny}`)
  const obj = typeof res === 'object' && res !== null ? res : undefined

  return pick(obj?.stderr) ?? pick(obj?.error) ?? pick(typeof res === 'string' ? res : undefined) ?? pick(r?.text)
}

/** Length of the union of [start, end] spans, so overlapping parallel calls count once. */
const unionMs = (spans: [number, number][]): number => {
  let total = 0
  let end = -Infinity
  for (const [a, b] of spans.slice().sort((x, y) => x[0] - y[0])) {
    if (b <= end) continue
    total += b - Math.max(a, end)
    end = b
  }

  return total
}

// Flow graph: agent boxes in one row; below this width per box the agents are drawn as lines instead.
const NODE_MAX_W = 34
const NODE_MIN_W = 16

/** Box width that fits n agents side by side (1-cell gap), or 0 when they don't fit. */
const nodeWidth = (n: number, columns: number): number => {
  const w = Math.min(NODE_MAX_W, Math.floor((columns - (n - 1)) / n))

  return w >= NODE_MIN_W ? w : 0
}

/** The terminal's fan line over (or under) n boxes of width w: ┌──┬──┴──┬──┐ / └──┴──┬──┴──┘. */
const fanLine = (n: number, w: number, isTop: boolean): string => {
  const total = n * w + (n - 1)
  if (n === 1) return '│'.padStart(Math.floor(w / 2) + 1).padEnd(total)
  const centers = Array.from({ length: n }, (_, i) => i * (w + 1) + Math.floor(w / 2))
  const mid = Math.floor(total / 2)
  const first = centers[0] ?? 0
  const last = centers[n - 1] ?? 0
  const cells: string[] = Array.from({ length: total }, (_, x) => (x > first && x < last ? '─' : ' '))
  centers.forEach(c => (cells[c] = isTop ? '┬' : '┴'))
  cells[first] = isTop ? '┌' : '└'
  cells[last] = isTop ? '┐' : '┘'
  cells[mid] = centers.includes(mid) ? '┼' : isTop ? '┴' : '┬'

  return cells.join('')
}

const bar = (percent: number): string => {
  const filled = Math.max(0, Math.min(BAR_W, Math.round((percent / 100) * BAR_W)))

  return '█'.repeat(filled) + '░'.repeat(BAR_W - filled)
}

/** One line of the flow: a run of the same main-chat tool folds into one step (Read ×3). */
type Step =
  | { kind: 'tool'; label: string; detail?: string; error?: string; count: number; startedAt: number; endedAt?: number; isDone: boolean; isError: boolean }
  | { kind: 'advisor'; startedAt: number }
  | { kind: 'agents'; ids: string[]; startedAt: number }

const stepsOf = (list: ToolItem[], agentList: AgentItem[]): Step[] => {
  const steps: Step[] = []
  for (const one of list) {
    const prev = steps[steps.length - 1]
    if (one.kind === 'advisor') {
      steps.push({ kind: 'advisor', startedAt: one.startedAt })
      continue
    }
    if (one.label === 'Agent') {
      const spawned = agentList.filter(a => a.toolUseId === one.id).map(a => a.id)
      if (prev?.kind === 'agents') prev.ids.push(...spawned)
      else steps.push({ kind: 'agents', ids: spawned, startedAt: one.startedAt })
      continue
    }
    if (prev?.kind === 'tool' && prev.label === one.label && prev.isDone && !prev.isError) {
      prev.count += 1
      prev.detail = one.detail ?? prev.detail
      prev.isDone = one.isDone
      prev.isError = !!one.isError
      prev.error = one.error
      prev.endedAt = one.endedAt
      continue
    }
    steps.push({
      kind: 'tool',
      label: one.label,
      detail: one.detail,
      error: one.error,
      count: 1,
      startedAt: one.startedAt,
      endedAt: one.endedAt,
      isDone: one.isDone,
      isError: !!one.isError,
    })
  }

  const claimed = new Set(steps.flatMap(step => (step.kind === 'agents' ? step.ids : [])))
  // Agents no main-chat Agent call claims (a Workflow's, a subagent's own, an id that did not match) still draw, by run, in time order.
  const loose = new Map<number, AgentItem[]>()
  for (const one of agentList) {
    if (claimed.has(one.id)) continue
    loose.set(one.group, [...(loose.get(one.group) ?? []), one])
  }
  for (const group of loose.values()) {
    steps.push({ kind: 'agents', ids: group.map(one => one.id), startedAt: Math.min(...group.map(one => one.startedAt)) })
  }

  return steps.filter(step => step.kind !== 'agents' || step.ids.length > 0).sort((a, b) => a.startedAt - b.startedAt)
}

const refreshModel = async ($: Ctx & { session: { model(): Promise<string> } }) => {
  try {
    const current = await $.session.model()
    await update($, model, () => current)
  } catch {
    await update($, model, () => '')
  }
}

/** Context fill, cost and the 5h/7d windows: the status line's own figures; the plain call costs nothing. */
const refreshSession = async ($: Ctx & { session: { usage(): Promise<SessionUsage> } }) => {
  try {
    const u = await $.session.usage()
    const limit = (kind: string) => u.rateLimits.find(one => one.kind === kind)?.percentUsed
    const next: SessionNumbers = {
      usd: u.cost?.usd,
      contextPercent: u.context.percent,
      contextTokens: u.context.tokens,
      contextWindow: u.context.window,
      fiveHour: limit('five_hour'),
      sevenDay: limit('seven_day'),
    }
    await update($, session, () => next)
  } catch {
    // keep the last numbers
  }
}

// One second tick for the session (long-lived timers start at session.start), writing only while something runs.
let tick: { cancel(): void } | undefined

const startTick = ($: Ctx & { clock: { every(ms: number, fn: () => void): { cancel(): void } } }) => {
  if (tick) return
  try {
    tick = $.clock.every(1000, () => {
      void (async () => {
        const isBusy = (await read($, isWorking)) || (await read($, agents)).some(one => !one.isDone)
        if (isBusy) await update($, clock, () => Date.now())
      })()
    })
  } catch {
    tick = undefined
  }
}

/** One last write so finished elapsed times settle; the tick itself keeps running but writes only while busy. */
const settleClock = async ($: Ctx) => {
  await update($, clock, () => Date.now())
}

/** True for a folder named Code or anything below one (case and slash style ignored): chats there open the pane on their own. */
const isUnderCode = (cwd?: string): boolean =>
  (cwd ?? '')
    .replace(/\\/g, '/')
    .toLowerCase()
    .split('/')
    .includes('code')

// The prompt the person typed, held until the main loop's turn.start takes it; a start without one is a continuation.
let pendingPrompt: string | undefined

// Auto-open once per chat; a close by the person keeps it shut (module vars reset on reload, panes() covers that).
let hasAutoOpened = false
let wasClosedByPerson = false

const autoOpen = async ($: Ctx & { ui: { open(a: { id: string; title: string }): Promise<unknown>; panes(): Promise<readonly { id: string }[]> } }) => {
  if (hasAutoOpened || wasClosedByPerson) return
  hasAutoOpened = true
  try {
    let isUp = false
    try {
      isUp = (await $.ui.panes()).some(one => one.id === PANE)
    } catch {
      // panes() unavailable: just open
    }
    if (!isUp) await $.ui.open({ id: PANE, title: 'Live view' })
  } catch {
    // no surface to draw on; /live-view still works
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'live-view',
      description: 'Show who is working, on which model, in this chat',
    })
    await refreshModel($)
    await refreshSession($)
    startTick($)
    // Chats under a Code folder open the pane; the engine itself holds an unasked open until 144 columns.
    if (isUnderCode((e as { cwd?: string }).cwd)) await autoOpen($)

    return next(e)
  })

  on('command.run', { command: 'live-view' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Live view' })

    return { text: 'Live view opened.' }
  })

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    const ev = e as unknown as { id?: string; origin?: { kind?: string } | string }
    const kind = typeof ev.origin === 'string' ? ev.origin : ev.origin?.kind
    if (ev.id === PANE && kind === 'person') wasClosedByPerson = true

    return closed
  })

  // Plan mode on -> open.
  on('prompt.attachment', { type: 'plan_mode' }, async ($, e, next) => {
    await autoOpen($)

    return next(e)
  })

  // Workflow orchestration starts -> open.
  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    await autoOpen($)

    return next(e)
  })

  // Only what the person typed starts a turn; meta prompts (notifications) and slash commands do not.
  on('prompt.submit', async ($, e, next) => {
    const submitted = await next(e)
    const text = e.text.trim()
    // Background-task wakes arrive as prompts with isMeta unset; skip their XML/system wrappers.
    const automated = /^<(task-notification|system-reminder|side-sessions-event|ci-monitor-event)\b/.test(text) || text.startsWith('[SYSTEM NOTIFICATION')
    if (!e.isMeta && !e.command && text && !automated) pendingPrompt = e.text

    return submitted
  })

  // A main-loop start with a fresh prompt is a new turn; one without (a background agent woke the chat) continues the current turn.
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      await refreshModel($)
      await update($, isWorking, () => true)
      const now = Date.now()
      const prompt = pendingPrompt
      pendingPrompt = undefined
      await update($, turns, list => {
        const last = list[list.length - 1]
        if (prompt === undefined && last) return list.map(one => (one === last ? { ...one, endedAt: undefined, reason: undefined } : one))
        const n = (last?.n ?? 0) + 1

        return [...list, { n, prompt: prompt ?? '', startedAt: now }].slice(-MAX_TURNS)
      })
      await update($, clock, () => now)
      startTick($)
    }

    return next(e)
  })

  // One model request: its real token counts, by the model that answered, and any advisor call the API ran inside it.
  on('turn.step', async function* ($, e, next) {
    const step = yield* next(e)
    const usage = step.usage
    if (usage) {
      const used = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens
      await update($, models, all => {
        const old = all[usage.model] ?? { requests: 0, input: 0, output: 0, cached: 0 }

        return {
          ...all,
          [usage.model]: {
            requests: old.requests + 1,
            input: old.input + usage.input_tokens + usage.cache_creation_input_tokens,
            output: old.output + usage.output_tokens,
            cached: old.cached + usage.cache_read_input_tokens,
          },
        }
      })
      const agentId = e.agentId
      if (agentId) {
        await update($, agents, list => list.map(one => (one.id === agentId ? { ...one, tokens: one.tokens + used } : one)))
      }
    }
    const advised = (step.serverToolUses ?? []).filter(one => one.name === 'advisor').length
    if (advised > 0) {
      const now = Date.now()
      await update($, advisor, old => ({ calls: old.calls + advised, lastAt: now }))
      if (!e.agentId) {
        const turn = (await read($, turns)).at(-1)?.n ?? 0
        await update($, tools, list =>
          [
            ...list,
            { id: `advisor-${now}`, label: 'Advisor', agentId: '', turn, startedAt: now, endedAt: now, isDone: true, kind: 'advisor' as const },
          ].slice(-MAX_TOOLS),
        )
      }
    }
    await refreshSession($)

    return step
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const agentId = (e as { agentId?: string }).agentId
    const now = Date.now()
    if (agentId) {
      await update($, agents, list =>
        list.map(one =>
          one.id === agentId ? { ...one, isDone: true, seconds: Math.round(e.durationMs / 100) / 10 } : one,
        ),
      )
    } else {
      await update($, isWorking, () => false)
      const reason = (e as { reason?: string }).reason
      await update($, turns, list => list.map((one, i) => (i === list.length - 1 && !one.endedAt ? { ...one, endedAt: now, reason } : one)))
    }
    await settleClock($)
    await refreshSession($)

    return done
  })

  on('tool.call', async ($, e, next) => {
    const label = toolName(e.tool)
    if (HIDDEN_TOOLS.has(label)) return next(e)
    const turn = (await read($, turns)).at(-1)?.n ?? 0
    const item: ToolItem = {
      id: e.tool_use_id ?? `${label}-${Date.now()}`,
      label,
      detail: detailOf(label, e),
      path: pathOf(label, e),
      agentId: e.agentId ?? '',
      turn,
      startedAt: Date.now(),
      isDone: false,
    }
    await update($, tools, list => [...list, item].slice(-MAX_TOOLS))
    await update($, callCount, n => n + 1)
    if (item.agentId) {
      const now = item.detail ? `${label} · ${item.detail}` : label
      await update($, agents, list => list.map(one => (one.id === item.agentId ? { ...one, tools: one.tools + 1, now } : one)))
    }
    let isError = false
    let error: string | undefined
    try {
      const ran = await next(e)
      isError = typeof ran === 'object' && ran !== null && (!!(ran as { isError?: boolean }).isError || 'deny' in ran)
      if (isError) error = errorOf(ran)

      return ran
    } catch (err) {
      isError = true
      error = errorOf(undefined, err)
      throw err
    } finally {
      const endedAt = Date.now()
      await update($, tools, list => list.map(one => (one.id === item.id ? { ...one, isDone: true, isError, error, endedAt } : one)))
    }
  })

  on('agent.spawn', async ($, e, next) => {
    await autoOpen($)
    const started = await next(e)
    const turn = (await read($, turns)).at(-1)?.n ?? 0
    await update($, agents, list => {
      const last = list.reduce((max, one) => Math.max(max, one.group), 0)
      const hasRunning = list.some(one => !one.isDone)
      const item: AgentItem = {
        id: started.agentId ?? e.tool_use_id,
        toolUseId: e.tool_use_id,
        type: e.subagentType,
        model: started.model ?? e.model ?? e.parentModel,
        task: e.description,
        isDone: false,
        startedAt: Date.now(),
        turn,
        group: hasRunning ? Math.max(last, 1) : last + 1,
        tools: 0,
        tokens: 0,
      }

      return [...list, item].slice(-MAX_AGENTS)
    })
    startTick($)

    return started
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    // A percent height does not resolve in the pane; fill its rows so the dark background reaches the bottom.
    const isTerminal = e.surface === 'terminal'
    const rows = (e as { props?: { scroll?: { bodyRows?: number } } }).props?.scroll?.bodyRows
    const columns = (e as { props?: { bodyColumns?: number } }).props?.bodyColumns ?? 80
    const toolList = await read($, tools)
    const agentList = await read($, agents)
    const turnList = await read($, turns)
    const ticked = await read($, clock)
    const totalCalls = await read($, callCount)
    const current = await read($, model)
    const working = await read($, isWorking)
    const byModel = await read($, models)
    const nums = await read($, session)
    const adv = await read($, advisor)
    const now = Math.max(ticked, Date.now())
    const modelRows = Object.entries(byModel).sort((a, b) => b[1].output + b[1].input - (a[1].output + a[1].input))
    const grand = modelRows.reduce((sum, [, v]) => sum + v.input + v.output, 0)
    const running = agentList.filter(one => !one.isDone).length

    // Calls seen before any turn.start (a reload mid-turn) still draw, under turn 0.
    const first = toolList[0] ?? agentList[0]
    const turn: TurnItem | undefined = turnList[turnList.length - 1] ?? (first ? { n: 0, prompt: '', startedAt: first.startedAt } : undefined)
    const turnN = turn?.n ?? 0
    const mainCalls = toolList.filter(one => one.agentId === '' && one.turn === turnN)
    const allSteps = stepsOf(mainCalls, agentList.filter(one => one.turn === turnN))
    const steps = allSteps.slice(-SHOWN_STEPS)
    const hiddenSteps = allSteps.length - steps.length
    const turnAgents = agentList.filter(one => one.turn === turnN)
    // Agents still running from an earlier turn (background work) stay on screen at the top of this one.
    const carried = agentList.filter(one => !one.isDone && one.turn !== turnN)
    const earlier = turnList.slice(0, -1).slice(-SHOWN_TURNS)
    // Where the turn's time went: inside tools/agents vs. the model thinking (or waiting on the person).
    const turnCalls = toolList.filter(one => one.turn === turnN && one.kind !== 'advisor')
    const turnEnd = turn?.endedAt ?? now
    const spans: [number, number][] = [
      ...turnCalls.map((one): [number, number] => [one.startedAt, one.endedAt ?? now]),
      ...turnAgents.map((one): [number, number] => [one.startedAt, one.isDone && one.seconds !== undefined ? one.startedAt + one.seconds * 1000 : now]),
    ]
    const clipped = spans.map(([a, b]): [number, number] => [Math.max(a, turn?.startedAt ?? a), Math.min(b, turnEnd)]).filter(([a, b]) => b > a)
    const busyMs = unionMs(clipped)
    const thinkMs = Math.max(0, turnEnd - (turn?.startedAt ?? turnEnd) - busyMs)
    // What Main is doing right now: the running tool, agents it waits on, or the model between calls.
    const runningCalls = mainCalls.filter(one => !one.isDone && one.kind !== 'advisor')
    const lastCall = runningCalls[runningCalls.length - 1]
    const lastEnd = mainCalls.reduce((max, one) => Math.max(max, one.endedAt ?? 0), turn?.startedAt ?? now)
    const nowLine = lastCall
      ? `${lastCall.label}${lastCall.detail ? ` · ${clip(lastCall.detail, 28)}` : ''} · ${dur(now - lastCall.startedAt)}${runningCalls.length > 1 ? ` +${runningCalls.length - 1}` : ''}`
      : running > 0
        ? `waiting on ${running} agent${running === 1 ? '' : 's'}`
        : `thinking · ${dur(now - lastEnd)}`
    // Distinct files touched this turn (main chat and subagents).
    const fileKinds = { read: new Set<string>(), edited: new Set<string>(), written: new Set<string>() }
    for (const one of turnCalls) {
      if (!one.path) continue
      if (one.label === 'Read') fileKinds.read.add(one.path)
      else if (one.label === 'Write') fileKinds.written.add(one.path)
      else fileKinds.edited.add(one.path)
    }
    const changed = [...new Set([...fileKinds.edited, ...fileKinds.written])]
    const changedNames = changed.slice(0, 3).map(baseName).join(', ') + (changed.length > 3 ? ` +${changed.length - 3}` : '')
    const hasFiles = fileKinds.read.size + changed.length > 0
    const line = (text = '│') => (
      <Box alignSelf="center">
        <Text dimColor>{text}</Text>
      </Box>
    )

    const agentBox = (one: AgentItem, w: number) => (
      <Box borderStyle="round" borderColor={one.isDone ? DONE : colorOf(one.model)} flexDirection="column" paddingX={1} width={w}>
        <Text bold wrap="truncate-end">
          {one.type}
        </Text>
        <Text color={colorOf(one.model)} wrap="truncate-end">
          {pretty(one.model)}
        </Text>
        <Text dimColor wrap="truncate-end">
          {one.task}
        </Text>
        <Text wrap="truncate-end">
          <Text color={one.isDone ? DONE : RUNNING}>{one.isDone ? '✓ ' : '● '}</Text>
          <Text dimColor>
            {one.isDone && one.seconds !== undefined ? `${one.seconds}s` : dur(now - one.startedAt)} · {one.tools} tool
            {one.tools === 1 ? '' : 's'} · {fmt(one.tokens)} tok
          </Text>
        </Text>
        {!one.isDone && (
          <Text dimColor wrap="truncate-end">
            ↳ {one.now ?? 'starting…'}
          </Text>
        )}
      </Box>
    )

    const agentLine = (one: AgentItem) => (
      <Text dimColor={one.isDone} wrap="truncate-end">
        {'  '}
        <Text color={one.isDone ? DONE : RUNNING}>{one.isDone ? '✓ ' : '● '}</Text>
        {one.type} · <Text color={colorOf(one.model)}>{pretty(one.model)}</Text> · {one.task}
        <Text dimColor>
          {' '}
          · {one.isDone && one.seconds !== undefined ? `${one.seconds}s` : dur(now - one.startedAt)} · {one.tools} tool
          {one.tools === 1 ? '' : 's'}
          {!one.isDone && one.now ? ` · ${one.now}` : ''}
        </Text>
      </Text>
    )

    const fan = (list: AgentItem[]) => {
      const w = nodeWidth(list.length, columns - 2)
      if (!w) return <Box flexDirection="column">{list.map(agentLine)}</Box>

      return (
        <Box flexDirection="column" alignItems="center">
          {isTerminal ? line(fanLine(list.length, w, true)) : line('↓')}
          <Box flexDirection="row" columnGap={1}>
            {list.map(one => agentBox(one, w))}
          </Box>
          {isTerminal ? line(fanLine(list.length, w, false)) : line('↓')}
        </Box>
      )
    }

    const stepRow = (step: Step) => {
      if (step.kind === 'advisor') {
        return (
          <Text>
            <Text color={COLORS.Opus}>◆ </Text>Advisor <Text dimColor>· consulted</Text>
          </Text>
        )
      }
      if (step.kind === 'agents') {
        const list = step.ids.map(id => agentList.find(one => one.id === id)).filter((one): one is AgentItem => !!one)
        const open = list.filter(one => !one.isDone).length

        return (
          <Box flexDirection="column" alignItems="center" alignSelf="center">
            <Text>
              <Text color={open ? RUNNING : DONE}>⑂ </Text>
              Delegate to {list.length} agent{list.length === 1 ? '' : 's'}
              <Text dimColor> · {open ? `${open} running` : 'all done'}</Text>
            </Text>
            {fan(list)}
          </Box>
        )
      }
      const mark = step.isError ? '✗ ' : step.isDone ? '✓ ' : '● '
      const markColor = step.isError ? DIM_RED : step.isDone ? DONE : RUNNING
      const took = step.isDone ? dur((step.endedAt ?? step.startedAt) - step.startedAt) : dur(now - step.startedAt)

      return (
        <Box flexDirection="column" alignItems="center">
          <Text dimColor={step.isDone && !step.isError} wrap="truncate-end">
            <Text color={markColor}>{mark}</Text>
            <Text bold={!step.isDone}>{step.label}</Text>
            {step.count > 1 ? ` ×${step.count}` : ''}
            {step.detail ? ` · ${step.detail}` : ''}
            <Text dimColor> · {step.isDone ? took : `${took}…`}</Text>
          </Text>
          {step.isError && step.error && (
            <Text color={DIM_RED} wrap="truncate-end">
              ↳ {step.error}
            </Text>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" minHeight={isTerminal ? rows : undefined} backgroundColor={isTerminal ? TERMINAL_BG : undefined}>
        <Text bold>This chat</Text>
        <Text>
          {working ? '● ' : '○ '}Main · <Text color={colorOf(current)}>{pretty(current)}</Text>
          <Text dimColor> · {working ? 'working…' : 'idle'}</Text>
        </Text>
        {nums.contextPercent !== undefined && (
          <Text>
            Context <Text color={nums.contextPercent >= 80 ? DIM_RED : '#e8962a'}>{bar(nums.contextPercent)}</Text> {nums.contextPercent}%
            <Text dimColor> · {fmt(nums.contextTokens ?? 0)}/{fmt(nums.contextWindow ?? 0)}</Text>
          </Text>
        )}
        {nums.usd !== undefined && (
          <Text>
            Cost <Text color={DONE}>${nums.usd.toFixed(2)}</Text>
            <Text dimColor> (list price)</Text>
          </Text>
        )}
        {nums.fiveHour !== undefined && (
          <Text>
            5h <Text color="#e0533a">{bar(nums.fiveHour)}</Text> {nums.fiveHour}%
            {nums.sevenDay !== undefined ? <Text dimColor> · 7d {nums.sevenDay}%</Text> : null}
          </Text>
        )}
        <Text> </Text>
        <Text bold>
          Models <Text dimColor>(tokens this session)</Text>
        </Text>
        {modelRows.length === 0 && <Text dimColor>None yet</Text>}
        {modelRows.map(([id, v]) => (
          <Text>
            <Text color={colorOf(id)}>{pretty(id)}</Text> {bar(grand ? ((v.input + v.output) / grand) * 100 : 0)}
            <Text dimColor>
              {' '}
              {fmt(v.input)} in · {fmt(v.output)} out · {fmt(v.cached)} cached · {v.requests} req
            </Text>
          </Text>
        ))}
        <Text> </Text>
        <Text bold>
          Live{' '}
          <Text dimColor>
            {turn ? `· turn ${turnN} · ${turn.endedAt ? dur(turn.endedAt - turn.startedAt) : dur(now - turn.startedAt)}` : ''} ·{' '}
            {totalCalls} tool calls · {agentList.length} agent{agentList.length === 1 ? '' : 's'}
            {running ? ` (${running} running)` : ''}
          </Text>
        </Text>
        {!turn && <Text dimColor>Waiting for the first prompt</Text>}
        {turn && (
          <Box flexDirection="column" marginTop={1}>
            <Box borderStyle="round" borderColor="#808080" paddingX={1}>
              <Text wrap="truncate-end">
                <Text dimColor>You · </Text>
                {turn.prompt ? clip(turn.prompt, 60) : <Text dimColor>continuing (background work woke the chat)</Text>}
              </Text>
            </Box>
            {line()}
            <Box flexDirection="row" alignItems="center" alignSelf="center">
              <Box borderStyle="round" borderColor={colorOf(current)} flexDirection="column" paddingX={1}>
                <Text bold color={colorOf(current)}>
                  Main · {pretty(current)}
                </Text>
                <Text dimColor>{working ? `● working · ${mainCalls.length} call${mainCalls.length === 1 ? '' : 's'}` : '○ idle'}</Text>
                {working && (
                  <Text color={lastCall ? RUNNING : undefined} dimColor={!lastCall}>
                    ↳ {nowLine}
                  </Text>
                )}
              </Box>
              {adv.calls > 0 && <Text dimColor> ◂┄ </Text>}
              {adv.calls > 0 && (
                <Box borderStyle="round" borderColor={COLORS.Opus} flexDirection="column" paddingX={1}>
                  <Text bold color={COLORS.Opus}>
                    Advisor
                  </Text>
                  <Text dimColor>
                    {adv.calls} call{adv.calls === 1 ? '' : 's'}
                  </Text>
                </Box>
              )}
            </Box>
            {carried.length > 0 && (
              <Box flexDirection="column" alignItems="center" alignSelf="center">
                {line()}
                <Text>
                  <Text color={RUNNING}>⑂ </Text>Still running from earlier
                </Text>
                {fan(carried)}
              </Box>
            )}
            {(steps.length > 0 || hiddenSteps > 0) && line()}
            {hiddenSteps > 0 && (
              <Box alignSelf="center">
                <Text dimColor>⋮ {hiddenSteps} earlier step{hiddenSteps === 1 ? '' : 's'}</Text>
              </Box>
            )}
            {steps.map(step => (
              <Box alignSelf="center">{stepRow(step)}</Box>
            ))}
            {hasFiles && (
              <Box flexDirection="column" alignItems="center" alignSelf="center">
                {line()}
                <Text dimColor wrap="truncate-end">
                  Files · {fileKinds.read.size} read
                  {changed.length > 0 ? ` · ${changed.length} changed (${changedNames})` : ''}
                </Text>
              </Box>
            )}
            {line(isTerminal ? '│' : '↓')}
            <Box borderStyle="round" flexDirection="column" borderColor={working ? '#e8962a' : turn.reason && turn.reason !== 'answer' ? DIM_RED : DONE} paddingX={1}>
              <Text>
                {working
                  ? `● working · ${dur(now - turn.startedAt)}`
                  : turn.reason && turn.reason !== 'answer'
                    ? `✗ ${turn.reason === 'aborted' ? 'interrupted' : turn.reason}`
                    : '✓ answered'}
                <Text dimColor>
                  {turnAgents.length ? ` · ${turnAgents.length} agent${turnAgents.length === 1 ? '' : 's'}` : ''}
                  {` · ${mainCalls.length} call${mainCalls.length === 1 ? '' : 's'}`}
                </Text>
              </Text>
              {busyMs + thinkMs > 0 && (
                <Text dimColor>
                  tools {dur(busyMs)} · thinking {dur(thinkMs)}
                </Text>
              )}
            </Box>
          </Box>
        )}
        {earlier.length > 0 && <Text> </Text>}
        {earlier.length > 0 && <Text bold>Earlier turns</Text>}
        {earlier
          .slice()
          .reverse()
          .map(one => {
            const calls = toolList.filter(t => t.agentId === '' && t.turn === one.n && t.kind !== 'advisor').length
            const spawned = agentList.filter(a => a.turn === one.n).length

            return (
              <Text dimColor wrap="truncate-end">
                {one.reason && one.reason !== 'answer' ? '✗ ' : '✓ '}
                {one.n} · {one.prompt ? clip(one.prompt, 32) : 'continuing'} · {calls} call{calls === 1 ? '' : 's'}
                {spawned ? ` · ${spawned} agent${spawned === 1 ? '' : 's'}` : ''}
                {one.endedAt ? ` · ${dur(one.endedAt - one.startedAt)}` : ''}
              </Text>
            )
          })}
      </Box>
    )
  })
}
