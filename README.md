<div align="center">

# 🔭 live-view

**A live pane for Claude Code that shows what your chat is doing, as it does it.**

Which model is running · what every step and subagent is working on · tokens, cost and limits

![Claude Code mod](https://img.shields.io/badge/Claude%20Code-mod-d97757)
![Version](https://img.shields.io/badge/version-0.3.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Surfaces](https://img.shields.io/badge/works%20in-Desktop%20%2B%20CLI-informational)

</div>

---

## ✨ What you get

| | |
|---|---|
| 💬 **This chat** | Main model (color-coded) and whether it's working or idle |
| 📊 **Header** | Context used, cost (list price), and your 5-hour / 7-day limits |
| 🧮 **Models** | Tokens in, out and cached per model, with request counts |
| 🔀 **Live flow** | A graph of the current turn: your prompt, the Main box, each step as it runs, and subagents fanning out in parallel |
| 🕘 **Earlier turns** | One line each for the last three |

### The live flow

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

- ✅ **Steps** show what they worked on (`Read · auth.ts`, `Bash · Run the tests`) with durations.
- 🔁 **Repeats fold** into one line (`Read ×3`).
- 🤖 **Subagents** get their own box with model, live tool, tokens and time.
- 👉 **Now line** in the Main box: the running tool with a live timer, `waiting on N agents`, or `thinking`.
- ❌ **Failures say why**: a failed step shows the first line of its error under the ✗.
- 📁 **Files** touched this turn: distinct files read, and which were edited or written.
- ⌛ **Time split** in the answer box: time inside tools and agents vs. thinking.
- ⏱️ **Timers tick every second** while anything is running.
- 🌙 **Background agents** from earlier turns stay at the top until they finish.

## 📦 Install

> Hooks modules are an early-access Claude Code feature, so behavior may change between versions.

```bash
claude plugin marketplace add OmarAlsaed01/live-view-mod
claude plugin install live-view@live-view-local
```

Then start a **new** chat. Running chats need a restart to pick up a mod.

**CLI only:** set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` before running `claude`.

```powershell
$env:CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = "1"; claude
```

## 🚀 Use

| Do this | To get this |
|---|---|
| Type `/live-view` | Open the pane in any chat |
| Start a chat in a folder named `Code` (or below one) | The pane opens on its own |
| Spawn a subagent, enter plan mode, or run a Workflow | The pane opens on its own |
| Close the pane with the **✕** | It stays closed for that chat |

In the terminal the pane opens once the window is **144+ columns** wide.

## 🧰 Manage

```bash
claude plugin disable live-view      # turn off everywhere
claude plugin enable live-view       # turn back on
claude plugin update live-view@live-view-local
claude plugin uninstall live-view
```

## ⚠️ Known gaps

- 💲 Cost is **list price**, not your plan bill.
- 🧠 The advisor shows a call count only, not the tokens it spent.
- 🔄 The model line refreshes once per turn, so it can lag a turn when plan mode flips models.
- 🎨 The pane can only draw text, boxes, colors and borders: no charts or animation.

## 🛠️ Develop

```bash
claude plugin validate .
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test .
npx -p typescript@5 tsc -p .
```

| File | What it is |
|---|---|
| `hooks/register.tsx` | The whole mod: events and the pane renderer |
| `types/index.d.ts` | The `$.state` contract (must match the atoms in `register.tsx`) |
| `tests/live-view.test.ts` | Mounts the pane on terminal and desktop |
| `.claude-plugin/` | `plugin.json` and the marketplace listing |

After editing, bump `version` in `.claude-plugin/plugin.json`, then run `claude plugin marketplace update live-view-local` and `claude plugin update live-view@live-view-local`.

## 📄 License

[MIT](LICENSE) © Omar Alsaed
