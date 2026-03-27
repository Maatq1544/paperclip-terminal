const PLUGIN_ID = "paperclip-terminal";
const TERMINAL_TAB_ID = "terminal-tab";
const TERMINAL_TOOL_ID = "terminal-exec";
const SESSION_TOOL_ID = "terminal-session";
const manifest = {
    id: PLUGIN_ID,
    apiVersion: 1,
    version: "1.0.0",
    displayName: "Terminal",
    description: "Interactive server terminal for Paperclip. Execute shell commands and manage persistent PTY sessions directly from the project view.",
    author: "Paperclip Community",
    categories: ["workspace", "ui"],
    capabilities: [
        "ui.detailTab.register",
        "agent.tools.register",
        "plugin.state.read",
        "plugin.state.write",
        "issues.read",
        "projects.read",
    ],
    instanceConfigSchema: {
        type: "object",
        properties: {
            defaultShell: {
                type: "string",
                title: "Default Shell",
                default: "/bin/bash",
                description: "Shell to use for terminal sessions (e.g. /bin/bash, /bin/zsh).",
            },
            sessionTimeoutSec: {
                type: "number",
                title: "Session Timeout (seconds)",
                default: 3600,
                description: "Automatically close idle PTY sessions after this many seconds.",
            },
            maxConcurrentSessions: {
                type: "number",
                title: "Max Concurrent Sessions",
                default: 5,
                description: "Maximum number of simultaneous PTY sessions per project.",
            },
        },
    },
    entrypoints: {
        worker: "./dist/worker.js",
        ui: "./dist/ui",
    },
    ui: {
        slots: [
            {
                type: "detailTab",
                id: TERMINAL_TAB_ID,
                displayName: "Terminal",
                exportName: "TerminalTab",
                entityTypes: ["project"],
                order: 20,
            },
        ],
    },
    tools: [
        {
            name: TERMINAL_TOOL_ID,
            displayName: "Terminal: Execute Command",
            description: "Execute a shell command on the server and return stdout + stderr. Use this for one-shot commands. For interactive sessions use Terminal: New Session.",
            parametersSchema: {
                type: "object",
                required: ["command"],
                properties: {
                    command: {
                        type: "string",
                        description: "The shell command to execute.",
                    },
                    cwd: {
                        type: "string",
                        description: "Working directory. Defaults to the workspace root.",
                    },
                    timeoutSec: {
                        type: "number",
                        description: "Timeout in seconds. Defaults to 60.",
                    },
                    env: {
                        type: "object",
                        description: "Additional environment variables to set.",
                    },
                },
            },
        },
        {
            name: SESSION_TOOL_ID,
            displayName: "Terminal: Session Manager",
            description: "Create and manage persistent interactive PTY terminal sessions.",
            parametersSchema: {
                type: "object",
                required: ["action"],
                properties: {
                    action: {
                        type: "string",
                        enum: ["create", "write", "resize", "close", "list"],
                        description: "Session action to perform.",
                    },
                    sessionId: {
                        type: "string",
                        description: "Session ID (required for write, resize, close).",
                    },
                    input: {
                        type: "string",
                        description: "Text to write to the PTY (for action=write).",
                    },
                    cols: {
                        type: "number",
                        description: "Terminal columns for resize or new session.",
                    },
                    rows: {
                        type: "number",
                        description: "Terminal rows for resize or new session.",
                    },
                },
            },
        },
    ],
};
export default manifest;
//# sourceMappingURL=manifest.js.map