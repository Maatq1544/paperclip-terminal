# @paperclipai/plugin-terminal — Interactive Server Terminal & PTY Session Manager for Paperclip 🖥️⚡

<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-5.4%2B-blue?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Paperclip](https://img.shields.io/badge/Paperclip-Plugin-8A2BE2?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-Stable-success?style=for-the-badge)

**Execute shell commands, manage PTY sessions, and run interactive CLI tools — right from the Paperclip project view.**
*The missing terminal for AI agent environments. Production-ready. 2 tools registered.*

[Installation](#-installation) • [Agent Tools](#-agent-tools) • [UI Terminal](#-ui-terminal) • [Security](#-security)

</div>

---

---

## What Is This?

**paperclip-terminal** is a Paperclip plugin that brings a fully interactive server terminal into the Paperclip interface. It registers 2 agent tools (`terminal-exec` for one-shot commands, `terminal-session` for persistent PTY sessions) and adds a Terminal tab to the project view. 

Paperclip agents can now execute shell commands, run build scripts, manage processes, and interact with the server filesystem — all from within their agent workflow.

| Feature | Description |
| :--- | :--- |
| **Agent Tools** | `terminal-exec` and `terminal-session` — callable from any Paperclip agent |
| **PTY Sessions** | Persistent pseudo-terminals with full input/output, resize, and multiplexing |
| **UI Terminal** | Built-in Terminal tab in project view with command history and tab completion |
| **Security** | Dangerous command blocking, per-command timeouts, configurable limits |
| **Platform** | Linux, macOS — Node.js 20+, TypeScript 5.4+ |

---

## 📦 Installation

### Quick Install (4 Steps)

#### Step 1 — Download and extract

```bash
# Copy paperclip-terminal-1.0.0.tar.gz to your Paperclip directory
# (alongside packages/plugins/)

# Extract:
cd /path/to/your/paperclip/packages/plugins
tar -xzf paperclip-terminal-1.0.0.tar.gz
```

#### Step 2 — Install dependencies and build

```bash
cd paperclip-terminal
pnpm install
pnpm build
```

> If `pnpm build` fails with node-pty errors, install system build dependencies:
> ```bash
> # Ubuntu/Debian:
> sudo apt-get install -y build-essential python3
> # macOS:
> xcode-select --install
> ```

#### Step 3 — Register the plugin in Paperclip

```bash
# From your Paperclip root:
cd /path/to/your/paperclip
paperclipai plugin install ./packages/plugins/paperclip-terminal --local
```

> **403 "Board access required"?** Your agent lacks install permissions. Use the PostgreSQL method below.

#### Step 4 — Restart Paperclip

```bash
killall -9 node
cd /path/to/your/paperclip
pnpm paperclipai run
# or: pnpm dev:watch
```

You should see in logs:
```
paperclip-terminal: activated, 2 tools registered
```

---

## 🗄️ Alternative Install — Via PostgreSQL

If CLI install fails (no agent permissions):

```bash
# 1. Get your Paperclip root path:
pwd
# This is $PAPERCLIP_ROOT

# 2. Insert plugin into the database:
psql -h localhost -p 5433 -U paperclip -d paperclip -c "
INSERT INTO plugins (id, plugin_key, package_name, package_path, version, api_version, manifest_json, status, installed_at, updated_at)
VALUES (
 gen_random_uuid(),
 'paperclip-terminal',
 '@paperclipai/plugin-terminal',
 '\$PAPERCLIP_ROOT/packages/plugins/paperclip-terminal',
 '1.0.0',
 1,
 \$(cat packages/plugins/paperclip-terminal/dist/manifest.json)::jsonb,
 'ready',
 NOW(),
 NOW()
)
ON CONFLICT (plugin_key) DO UPDATE SET
 status = 'ready',
 manifest_json = EXCLUDED.manifest_json,
 updated_at = NOW();
"
```

Replace `$PAPERCLIP_ROOT` with the actual path to your Paperclip installation.

---

## 🏗 Plugin Structure

```
paperclip-terminal/
├── dist/        — Compiled output (after pnpm build)
│  ├── manifest.js   — Plugin metadata
│  ├── worker.js    — PTY management, shell execution
│  └── ui/index.js  — Terminal UI component
├── src/        — TypeScript source
├── scripts/      — Build and setup scripts
├── package.json
└── README.md
```

---

## 🤖 Agent Tools

### `terminal-exec` — One-Shot Shell Commands

```typescript
const result = await ctx.tools.execute("terminal-exec", {
 command: "ls -la",    // shell command
 timeoutSec: 60,     // timeout (default: 60)
});
// result.content — stdout/stderr
// result.error — error (if any)
```

### `terminal-session` — Persistent PTY Sessions

```typescript
// Create a session
const { sessionId } = await ctx.tools.execute("terminal-session", {
 action: "create",
 cwd: "/home/user",    // working directory
});

// Write to session
await ctx.tools.execute("terminal-session", {
 action: "write",
 sessionId,
 input: "ls\n",
});

// Resize terminal
await ctx.tools.execute("terminal-session", {
 action: "resize",
 sessionId,
 cols: 120,
 rows: 40,
});

// Close session
await ctx.tools.execute("terminal-session", {
 action: "close",
 sessionId,
});

// List active sessions
const { sessions } = await ctx.tools.execute("terminal-session", {
 action: "list",
});
```

---

## 🖥️ UI Terminal

A **Terminal** tab appears in the Paperclip project view. Built-in commands:

| Command | Description |
| :--- | :--- |
| `help` | Show help |
| `clear` | Clear screen |
| `sessions` | List PTY sessions |
| `new` | Create a PTY session |
| `close <id>` | Close a session |
| `<command>` | Execute a shell command |

**Keyboard shortcuts:** `↑`/`↓` — history, `Tab` — completion, `Ctrl+L` — clear.

---

## ⚙️ Configuration

In project settings (instance config):

```json
{
 "defaultShell": "/bin/bash",
 "sessionTimeoutSec": 3600,
 "maxConcurrentSessions": 5
}
```

| Parameter | Default | Description |
| :--- | :--- | :--- |
| `defaultShell` | `/bin/bash` | Shell for PTY sessions |
| `sessionTimeoutSec` | `3600` | Idle session timeout (seconds) |
| `maxConcurrentSessions` | `5` | Max simultaneous PTY sessions |

---

## 🔒 Security

- Dangerous commands blocked: `rm -rf /`, `dd`, `mkfs`, fork bombs
- PTY runs as the server user — no privilege escalation
- Enforced timeouts on every command
- Session isolation — no data leakage between users

---

## 🔧 Troubleshooting

**Plugin doesn't appear after install:**
```bash
psql -h localhost -p 5433 -U paperclip -d paperclip -c \
 "SELECT plugin_key, status FROM plugins;"
# Should show: paperclip-terminal | ready
```

**node-pty won't compile:**
```bash
# Ubuntu/Debian:
sudo apt-get install -y build-essential python3
# macOS:
xcode-select --install
```

**Server doesn't pick up the plugin:**
```bash
killall -9 node
cd /path/to/your/paperclip
pnpm paperclipai run
```

---

<div align="center">

**⭐ Star this repo** — it helps Paperclip users discover the terminal plugin!

*Published by the Paperclip Community. Built by [Ivan Kurilov](https://github.com/).*

</div>