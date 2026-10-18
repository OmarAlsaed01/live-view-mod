<div align="center">

# 🔭 Live View

**See what your Claude Code chat is doing while it does it.**

A live pane that shows the model, every step and subagent as it runs, plus tokens, cost and limits.

![Claude Code mod](https://img.shields.io/badge/Claude%20Code-mod-d97757)
![Version](https://img.shields.io/badge/version-0.3.1-blue)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

---

## Why

The chat shows what Claude says. It doesn't show what is happening underneath: which tool is running, whether a subagent is stuck, which model did the work, how much it all cost. Live View puts that in a side pane, so a long task stops being a black box.

- **Flow graph** of the current turn: your prompt, the Main box, each step, and parallel subagents fanning out.
- **Now line** for what is running right now, with a live timer.
- **Failures say why**, with the first line of the error.
- **Usage at a glance**: tokens per model, context, cost, and your 5-hour and 7-day limits.

```
┌──────────────────────────────────────────────┐
│ You · spawn two Explore agents to summarize… │
└──────────────────────────────────────────────┘
                      │
              ┌───────────────┐
              │ Main · Sonnet │
              │ ● working     │
              └───────────────┘
                      │
         ✓ Read · auth.ts · 0.4s
         ✓ Bash · Run the tests · 3.1s
                      │
        ⑂ Delegate to 2 agents · 2 running
          ┌───────────┴───────────┐
   ┌─────────────┐         ┌─────────────┐
   │ Explore     │         │ Explore     │
   │ Haiku 5.5   │         │ Haiku 5.5   │
   │ ● 3.5s · 1  │         │ ● 3.5s · 2  │
   │ ↳ Read · …  │         │ ↳ Glob · …  │
   └─────────────┘         └─────────────┘
          └───────────┬───────────┘
                      │
┌──────────────────────────────────────────────┐
│ ✓ answered · 2 agents · 2 calls              │
└──────────────────────────────────────────────┘
```

## 📦 Install

Hooks modules are an early-access Claude Code feature, so behavior may change between versions.

```bash
claude plugin marketplace add OmarAlsaed01/live-view-mod
claude plugin install live-view@live-view-local
```

Start a new chat afterwards. Running chats only pick up a mod at start.

In the CLI, set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` before running `claude`:

```powershell
$env:CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = "1"; claude
```

## 🚀 Usage

| To do this | Do this |
|---|---|
| Open the pane | Type `/live-view` |
| Have it open on its own | Start a chat in a folder named `Code` (or below one), spawn a subagent, enter plan mode, or run a Workflow |
| Keep it closed for a chat | Close it with the X |

In the terminal the pane opens once the window is 144 columns wide or more.

### What each part shows

| Part | Contents |
|---|---|
| This chat | Main model (color-coded), working or idle |
| Header | Context used, cost at list price, 5-hour and 7-day limits |
| Models | Tokens in, out and cached per model, with request counts |
| Live flow | The graph above. Repeated calls fold (`Read ×3`), steps show what they worked on, timers tick every second |
| Earlier turns | One line each for the last three |

The flow also shows a Files line (distinct files read, edited or written), and the answer box splits time spent in tools and agents from time spent thinking.

## Manage

```bash
claude plugin disable live-view
claude plugin enable live-view
claude plugin update live-view@live-view-local
claude plugin uninstall live-view
```

## ⚠️ Known gaps

- Cost is list price, not your plan bill.
- The advisor shows a call count only, not the tokens it spent.
- The model line refreshes once per turn, so it can lag a turn when plan mode switches models.
- The pane draws text, boxes, colors and borders only. No charts or animation.

## 🛠️ Development

```bash
claude plugin validate .
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test .
npx -p typescript@5 tsc -p .
```

| File | Purpose |
|---|---|
| `hooks/register.tsx` | The whole mod: events and the pane renderer |
| `types/index.d.ts` | The `$.state` contract (must match the atoms in `register.tsx`) |
| `tests/live-view.test.ts` | Mounts the pane on terminal and desktop |
| `.claude-plugin/` | `plugin.json` and the marketplace listing |

After editing, bump `version` in `.claude-plugin/plugin.json`, then run `claude plugin marketplace update live-view-local` and `claude plugin update live-view@live-view-local`.

## Contributing

Bug reports and ideas are welcome: [open an issue](https://github.com/OmarAlsaed01/live-view-mod/issues). For a code change, fork the repo, make sure the tests and type-check above pass, and open a pull request.

## License

[MIT](LICENSE)
