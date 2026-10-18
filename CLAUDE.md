# live-view — contributor notes

A Claude Code **mod** (plugin with a hooks module) that draws a "Live view" pane. See `README.md` for what it shows and how to use it.

## Layout
- `hooks/register.tsx` — the whole mod (events: session.start, turn.start/step/complete, tool.call, agent.spawn, ui.render).
- `types/index.d.ts` — `$.state` contract (must match the atoms in register.tsx).
- `tests/live-view.test.ts` — mounts the pane on terminal + desktop.
- `.claude-plugin/` — `plugin.json`, `marketplace.json` (marketplace source `./`).

## Dev
- Validate: `claude plugin validate .`
- Test: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test .` (plugin tests are early access)
- Type-check: `npx -p typescript@5 tsc -p .` (needs the engine to have loaded the mod once so `.claude-plugin/types/` exists)
- After editing: bump `version` in `plugin.json`, then `claude plugin marketplace update live-view-local` and `claude plugin update live-view@live-view-local`; start a new chat.
- Mod API docs: load the `plugin-authoring` skill.

## Gotchas
- The UI kit has no `alignSelf="stretch"`; center narrow pieces with `alignSelf="center"`.
- The test kit refuses `$.clock.every`, so the 1s tick is only checked in a real chat.
- Hooks modules have no `process.env`; the auto-open rule is a path match on a `Code` folder segment.
- `ui.close` origin is `{ kind }`, not a string.
