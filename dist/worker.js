import { spawn } from "node:child_process";
import { v4 as uuidv4 } from "uuid";
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
const PLUGIN_NAME = "paperclip-terminal";
let _pluginLogger = null;
// ── PTY helpers ─────────────────────────────────────────────────────────────
// node-pty is optional — use it only when prebuilt binaries are present
// Dynamically import to avoid hard dependency on native module
let pty = null;
async function tryLoadPty() {
    try {
        // Use --no-experimental-detect-module to force CommonJS resolution
        const mod = await import("node-pty");
        pty = mod;
    }
    catch {
        pty = null;
    }
}
// ── Active sessions store ─────────────────────────────────────────────────────
const ptySessions = new Map();
const MAX_SESSIONS = 20;
function cleanupSession(sessionId) {
    const session = ptySessions.get(sessionId);
    if (!session)
        return;
    try {
        if (session.pty) {
            session.pty.kill();
        }
    }
    catch {
        // ignore
    }
    ptySessions.delete(sessionId);
}
// ── PTY session management ───────────────────────────────────────────────────
function createPtySession(opts) {
    if (ptySessions.size >= MAX_SESSIONS) {
        return { error: `Maximum concurrent sessions (${MAX_SESSIONS}) reached` };
    }
    const shell = opts.shell || process.env.SHELL || "/bin/bash";
    const cols = opts.cols || 80;
    const rows = opts.rows || 24;
    const cwd = opts.cwd || process.cwd();
    if (!pty) {
        return { error: "node-pty is not available. PTY sessions are disabled." };
    }
    let ipty;
    try {
        ipty = pty.spawn(shell, [], {
            cols,
            rows,
            cwd,
            env: { ...process.env },
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { error: `Failed to spawn PTY: ${msg}` };
    }
    const sessionId = uuidv4();
    const session = {
        id: sessionId,
        pty: ipty,
        cols,
        rows,
        cwd,
        createdAt: Date.now(),
        outputBuffer: "",
    };
    ptySessions.set(sessionId, session);
    return { sessionId, pid: ipty.pid };
}
function writePtySession(sessionId, input) {
    const session = ptySessions.get(sessionId);
    if (!session)
        return { error: `Session ${sessionId} not found` };
    try {
        session.pty.write(input);
        return { ok: true };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { error: `Write failed: ${msg}` };
    }
}
function resizePtySession(sessionId, cols, rows) {
    const session = ptySessions.get(sessionId);
    if (!session)
        return { error: `Session ${sessionId} not found` };
    try {
        session.pty.resize(cols, rows);
        session.cols = cols;
        session.rows = rows;
        return { ok: true };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { error: `Resize failed: ${msg}` };
    }
}
function closePtySession(sessionId) {
    const session = ptySessions.get(sessionId);
    if (!session)
        return { error: `Session ${sessionId} not found` };
    cleanupSession(sessionId);
    return { ok: true };
}
function listPtySessions() {
    return [...ptySessions.values()].map((s) => ({
        id: s.id,
        pid: s.pty.pid,
        cols: s.cols,
        rows: s.rows,
        cwd: s.cwd,
        ageSec: Math.floor((Date.now() - s.createdAt) / 1000),
    }));
}
// ── One-shot exec ────────────────────────────────────────────────────────────
function execCommand(opts) {
    return new Promise((resolve) => {
        const timeoutMs = (opts.timeoutSec ?? 60) * 1000;
        const cwd = opts.cwd || process.cwd();
        const env = { ...process.env, ...opts.env };
        const child = spawn(opts.command, [], {
            shell: true,
            cwd,
            env,
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const finish = (code, timedOut, error) => {
            if (settled)
                return;
            settled = true;
            child.kill();
            resolve({ stdout, stderr, exitCode: code, timedOut, error });
        };
        const timer = timeoutMs > 0
            ? setTimeout(() => finish(null, true), timeoutMs)
            : null;
        child.stdout?.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
        });
        child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
        });
        child.on("close", (code) => {
            if (timer)
                clearTimeout(timer);
            finish(code, false);
        });
        child.on("error", (err) => {
            if (timer)
                clearTimeout(timer);
            finish(null, false, err.message);
        });
    });
}
// ── Plugin ───────────────────────────────────────────────────────────────────
const plugin = definePlugin({
    async setup(ctx) {
        _pluginLogger = ctx.logger;
        await tryLoadPty();
        ctx.logger.info(`${PLUGIN_NAME} plugin setup — node-pty available: ${pty !== null}`);
        // ── Tool: terminal.exec ─────────────────────────────────────────────────
        ctx.tools.register("terminal-exec", {
            displayName: "Terminal: Execute Command",
            description: "Execute a shell command on the server. Returns stdout, stderr, and exit code.",
            parametersSchema: {
                type: "object",
                required: ["command"],
                properties: {
                    command: { type: "string", description: "Shell command to execute" },
                    cwd: { type: "string", description: "Working directory" },
                    timeoutSec: { type: "number", description: "Timeout in seconds", default: 60 },
                    env: { type: "object", description: "Extra environment variables" },
                },
            },
        }, async (params, runCtx) => {
            const { command, cwd, timeoutSec = 60, env } = params;
            ctx.logger.info(`[terminal-exec] agent=${runCtx.agentId} cmd=${command}`);
            // Security: restrict dangerous commands
            const dangerous = [
                /^rm\s+-rf\s+\//,
                /^dd\s+/,
                /^mkfs\./,
                /^:()\{/,
            ];
            const isDangerous = dangerous.some((re) => re.test(command.trim()));
            if (isDangerous) {
                return {
                    content: `[SECURITY] Command blocked: potentially destructive command detected.\nIf you need to run this, use terminal.session (create + write) instead.`,
                    error: "Command blocked for safety",
                };
            }
            const result = await execCommand({ command, cwd, timeoutSec, env });
            const lines = [
                `Command: ${command}`,
                `CWD: ${cwd ?? process.cwd()}`,
                `Exit code: ${result.exitCode ?? "signal"}`,
                result.timedOut ? `⚠ TIMEOUT after ${timeoutSec}s` : "",
                result.error ? `Error: ${result.error}` : "",
                result.stdout ? `\n--- stdout ---\n${result.stdout}` : "",
                result.stderr ? `\n--- stderr ---\n${result.stderr}` : "",
            ]
                .filter(Boolean)
                .join("\n");
            return { content: lines };
        });
        // ── Tool: terminal.session ───────────────────────────────────────────────
        ctx.tools.register("terminal-session", {
            displayName: "Terminal: Session Manager",
            description: "Manage interactive PTY terminal sessions: create, write, resize, close, list.",
            parametersSchema: {
                type: "object",
                required: ["action"],
                properties: {
                    action: { type: "string", enum: ["create", "write", "resize", "close", "list"], description: "Session action" },
                    sessionId: { type: "string", description: "Session ID" },
                    input: { type: "string", description: "Text to write (for action=write)" },
                    cols: { type: "number", description: "Terminal columns", default: 80 },
                    rows: { type: "number", description: "Terminal rows", default: 24 },
                    cwd: { type: "string", description: "Working directory for new session" },
                },
            },
        }, async (params, runCtx) => {
            const p = params;
            ctx.logger.info(`[terminal-session] agent=${runCtx.agentId} action=${p.action}`);
            switch (p.action) {
                case "create": {
                    const config = await ctx.config.get();
                    const shell = String(config?.defaultShell ?? process.env.SHELL ?? "/bin/bash");
                    const result = createPtySession({
                        shell,
                        cols: p.cols ?? 80,
                        rows: p.rows ?? 24,
                        cwd: p.cwd,
                    });
                    if ("error" in result) {
                        return {
                            content: `Failed to create session: ${result.error}`,
                            error: result.error,
                        };
                    }
                    const sessions = listPtySessions();
                    return {
                        content: `Session created successfully.\nSession ID: ${result.sessionId}\nPID: ${result.pid}\nActive sessions: ${sessions.length}`,
                        data: { sessionId: result.sessionId, pid: result.pid },
                    };
                }
                case "write": {
                    if (!p.sessionId) {
                        return { content: "sessionId is required for write action", error: "missing sessionId" };
                    }
                    const result = writePtySession(p.sessionId, p.input ?? "");
                    if ("error" in result) {
                        return { content: result.error, error: result.error };
                    }
                    return { content: "Input written to PTY session." };
                }
                case "resize": {
                    if (!p.sessionId) {
                        return { content: "sessionId is required for resize action", error: "missing sessionId" };
                    }
                    const result = resizePtySession(p.sessionId, p.cols ?? 80, p.rows ?? 24);
                    if ("error" in result) {
                        return { content: result.error, error: result.error };
                    }
                    return { content: `Session resized to ${p.cols ?? 80}x${p.rows ?? 24}` };
                }
                case "close": {
                    if (!p.sessionId) {
                        return { content: "sessionId is required for close action", error: "missing sessionId" };
                    }
                    const result = closePtySession(p.sessionId);
                    if ("error" in result) {
                        return { content: result.error, error: result.error };
                    }
                    return { content: `Session ${p.sessionId} closed.` };
                }
                case "list": {
                    const sessions = listPtySessions();
                    if (sessions.length === 0) {
                        return { content: "No active PTY sessions." };
                    }
                    const lines = sessions.map((s) => `${s.id}  pid=${s.pid}  ${s.cols}x${s.rows}  cwd=${s.cwd}  age=${s.ageSec}s`);
                    return { content: `Active sessions:\n${lines.join("\n")}` };
                }
                default:
                    return { content: `Unknown action: ${p.action}`, error: "invalid action" };
            }
        });
        ctx.logger.info(`${PLUGIN_NAME} tools registered`);
        // ── UI Bridge Actions ─────────────────────────────────────────────────────
        // These allow the React UI to call terminal functions directly without
        // going through the agent tool dispatch layer.
        ctx.actions.register("terminal-exec", async (params) => {
            const { command, cwd, timeoutSec = 60, env } = params;
            if (!command || typeof command !== "string") {
                throw new Error("command is required and must be a string");
            }
            const dangerous = [/^rm\s+-rf\s+\//, /^dd\s+/, /^mkfs\./, /^:\(\)\{/];
            if (dangerous.some((re) => re.test(command.trim()))) {
                return {
                    content: "[SECURITY] Command blocked.",
                    error: "Command blocked for safety",
                };
            }
            const result = await execCommand({ command, cwd, timeoutSec, env });
            return {
                content: [
                    `Command: ${command}`,
                    `Exit code: ${result.exitCode ?? "signal"}`,
                    result.timedOut ? `⚠ TIMEOUT after ${timeoutSec}s` : "",
                    result.error ? `Error: ${result.error}` : "",
                    result.stdout || "",
                    result.stderr ? `\n--- stderr ---\n${result.stderr}` : "",
                ]
                    .filter(Boolean)
                    .join("\n"),
                exitCode: result.exitCode,
                timedOut: result.timedOut,
            };
        });
        ctx.actions.register("terminal-session", async (params) => {
            const p = params;
            switch (p.action) {
                case "create": {
                    const config = await ctx.config.get();
                    const shell = String(config?.defaultShell ?? process.env.SHELL ?? "/bin/bash");
                    const result = createPtySession({ shell, cols: p.cols, rows: p.rows, cwd: p.cwd });
                    if ("error" in result)
                        throw new Error(result.error);
                    return { sessionId: result.sessionId, pid: result.pid };
                }
                case "write": {
                    if (!p.sessionId)
                        throw new Error("sessionId is required");
                    const result = writePtySession(p.sessionId, p.input ?? "");
                    if ("error" in result)
                        throw new Error(result.error);
                    return { ok: true };
                }
                case "resize": {
                    if (!p.sessionId)
                        throw new Error("sessionId is required");
                    const result = resizePtySession(p.sessionId, p.cols ?? 80, p.rows ?? 24);
                    if ("error" in result)
                        throw new Error(result.error);
                    return { ok: true };
                }
                case "close": {
                    if (!p.sessionId)
                        throw new Error("sessionId is required");
                    const result = closePtySession(p.sessionId);
                    if ("error" in result)
                        throw new Error(result.error);
                    return { ok: true };
                }
                case "list": {
                    const sessions = listPtySessions();
                    return { sessions: sessions.map((s) => ({ id: s.id, pid: s.pid, cwd: s.cwd, cols: s.cols, rows: s.rows, ageSec: s.ageSec })) };
                }
                default:
                    throw new Error(`Unknown action: ${p.action}`);
            }
        });
    },
    async onHealth() {
        return {
            status: "ok",
            message: `${PLUGIN_NAME} ready — PTY: ${pty ? "available" : "disabled"} — sessions: ${ptySessions.size}/${MAX_SESSIONS}`,
            details: {
                ptyAvailable: pty !== null,
                activeSessions: ptySessions.size,
                maxSessions: MAX_SESSIONS,
                nodeVersion: process.version,
                platform: process.platform,
                arch: process.arch,
            },
        };
    },
    async onValidateConfig(config) {
        const errors = [];
        const warnings = [];
        if (config?.defaultShell && typeof config.defaultShell === "string") {
            // Basic sanity check
            if (!config.defaultShell.startsWith("/")) {
                errors.push("defaultShell must be an absolute path (e.g. /bin/bash)");
            }
        }
        if (config?.sessionTimeoutSec !== undefined) {
            const timeout = Number(config.sessionTimeoutSec);
            if (!Number.isFinite(timeout) || timeout < 1) {
                errors.push("sessionTimeoutSec must be a positive number");
            }
            else if (timeout > 86400) {
                warnings.push("sessionTimeoutSec > 24h may cause resource accumulation");
            }
        }
        if (config?.maxConcurrentSessions !== undefined) {
            const max = Number(config.maxConcurrentSessions);
            if (!Number.isFinite(max) || max < 1) {
                errors.push("maxConcurrentSessions must be at least 1");
            }
            else if (max > 50) {
                warnings.push("maxConcurrentSessions > 50 may cause high resource usage");
            }
        }
        return { ok: errors.length === 0, errors: errors.length > 0 ? errors : undefined, warnings };
    },
    async onShutdown() {
        _pluginLogger?.info(`${PLUGIN_NAME} shutting down — cleaning up ${ptySessions.size} sessions`);
        for (const sessionId of [...ptySessions.keys()]) {
            cleanupSession(sessionId);
        }
    },
});
export default plugin;
runWorker(plugin, import.meta.url);
//# sourceMappingURL=worker.js.map