export type ToolItem = {
  id: string
  label: string
  /** What it worked on: a file name, a command's description, a pattern. */
  detail?: string
  /** '' for the main chat, else the subagent's id. */
  agentId: string
  /** The main-chat turn it ran in (1-based). */
  turn: number
  startedAt: number
  endedAt?: number
  isDone: boolean
  isError?: boolean
  /** 'advisor' marks an advisor consult drawn in the flow; absent for a tool call. */
  kind?: 'advisor'
}

export type AgentItem = {
  id: string
  /** The Agent call that spawned it, so the flow can draw it at that step. */
  toolUseId: string
  type: string
  model: string
  task: string
  isDone: boolean
  seconds?: number
  startedAt: number
  turn: number
  /** Run number: a new one starts when an agent spawns while none is running. */
  group: number
  /** Tool calls this agent made. */
  tools: number
  /** Input (uncached + cache) + output tokens this agent's requests used. */
  tokens: number
  /** The agent's latest tool call, as `Grep · "autoOpen"`. */
  now?: string
}

/** One main-chat turn: a prompt (or a continuation) through to the answer. */
export type TurnItem = {
  n: number
  prompt: string
  startedAt: number
  endedAt?: number
  reason?: string
}

/** Tokens one model has used this session, main chat and subagents together. */
export type ModelTotals = { requests: number; input: number; output: number; cached: number }

export type SessionNumbers = {
  usd?: number
  contextPercent?: number
  contextTokens?: number
  contextWindow?: number
  fiveHour?: number
  sevenDay?: number
}

export type AdvisorStats = { calls: number; lastAt?: number }

declare module 'claude-code' {
  interface PluginState {
    'live-view': {
      tools: ToolItem[]
      agents: AgentItem[]
      turns: TurnItem[]
      clock: number
      /** Every tool call seen, uncapped (the list itself keeps the last 200). */
      callCount: number
      model: string
      isWorking: boolean
      models: Record<string, ModelTotals>
      session: SessionNumbers
      advisor: AdvisorStats
    }
  }
}
