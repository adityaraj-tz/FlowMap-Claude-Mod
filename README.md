# Flowmap

A Claude Code mod that shows what Claude is doing, live: which agents run on which model, which
files it plans, reads and edits, how those files relate, and the one it is working on right now.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/files-dark.png">
  <img alt="Flowmap's Files view: files grouped into Client, API, Service, Domain, Data, Database and Tests lanes, with arrows between them and the file being edited glowing with its model" src="docs/files-light.png">
</picture>

- **Sidebar** in Claude Code with two tabs: **Files** (an architecture map grouped into
  Client → API → Service → Domain → Data → Database, plus Tests and Docs) and **Agents** (the main
  loop and each subagent with its model, tool calls and durations).
- **Browser view**: the same map as a full-screen diagram you can drag, zoom and pinch, with the
  layers wrapped to fit your screen, plus a timeline of the agents.
- **Planned files**: Claude calls the mod's `plan_files` tool before multi-file changes, so the files
  it is about to create show as dashed `NEW` / `PLAN` cards before they exist.

![Flowmap's Agents view: a timeline of the main loop and each subagent with its model, its tool calls and how long each took](docs/agents.png)

Works in any terminal, Windows included: the sidebar is plain text and the diagram opens in your browser.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install flowmap --marketplace adityaraj-tz/FlowMap-Claude-Mod
```

From a shell:

```sh
claude plugin install flowmap --marketplace adityaraj-tz/FlowMap-Claude-Mod
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with
`adityaraj-tz/FlowMap-Claude-Mod`, then **Add plugin**.

## Use

| Do | Type |
| --- | --- |
| Open the sidebar | `/flowmap`, then `f` Files · `a` Agents · `b` browser · `q` close |
| Open the full-screen diagram | `/flowmap web` |
| Jump straight to a tab | `/flowmap files` or `/flowmap agents` |
| Start the map over | `/flowmap clear` |

In the browser: drag to move, scroll or pinch to zoom, double-click or **Fit** to fit the screen.
It refreshes every 2 seconds and keeps your zoom; until you move it, it re-fits as files arrive.

If Claude starts a multi-file change without planning it, ask it to "plan the files on flowmap first".

## Legend

| Mark | Meaning |
| --- | --- |
| `○` dashed | planned, not touched yet |
| `+` | created |
| `✓` | edited |
| `·` | read |
| `✎` glowing | being edited now, with the model doing it |
| arrow | the file uses / names the other file's type |

## How it decides

- **Layer**: from the file's folder and name (`Controllers/` → API, `*Service` → Service,
  `Migrations/` → Database, …). The rules are `layerOf()` in `hooks/model.ts`.
- **Links**: file A points to file B when A's code names B's type (names of 4+ letters), plus any
  links Claude declares in `plan_files`.
- **Model**: subagents report theirs when they start; the main loop's is read at each prompt.

## Develop

```sh
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
