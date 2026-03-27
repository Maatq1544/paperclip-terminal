import { useState, useEffect, useRef, useCallback } from "react";
import { usePluginAction, useHostContext } from "@paperclipai/plugin-sdk/ui";

const TERMINAL_TAB_ID = "terminal-tab";

interface TerminalLine {
  id: string;
  type: "input" | "output" | "error" | "system";
  text: string;
  timestamp: number;
}

interface SessionInfo {
  id: string;
  pid: number;
  cwd: string;
}

const LINE_TYPES = {
  input: { color: "#a8dadc", prefix: "$" },
  output: { color: "#e0e0e0", prefix: "" },
  error: { color: "#ff6b6b", prefix: "✗" },
  system: { color: "#ffd93d", prefix: "●" },
};

function makeLines(): TerminalLine[] {
  return [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "system",
      text: "Paperclip Terminal v1.0.0 — Server Shell Access",
      timestamp: Date.now(),
    },
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "system",
      text: "Interactive terminal. Type 'help' for commands.",
      timestamp: Date.now(),
    },
  ];
}

function TerminalTab(_props: unknown) {
  const { entityId: projectId, companyId } = useHostContext();
  const terminalExec = usePluginAction("terminal-exec");
  const terminalSession = usePluginAction("terminal-session");

  const [lines, setLines] = useState<TerminalLine[]>(makeLines);
  const [currentInput, setCurrentInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const addLine = useCallback(
    (type: TerminalLine["type"], text: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setLines((prev) => [...prev, { id, type, text, timestamp: Date.now() }]);
    },
    [],
  );

  const executeCommand = useCallback(
    async (cmd: string) => {
      const trimmed = cmd.trim();
      if (!trimmed) return;

      // Built-in terminal commands
      if (trimmed === "help") {
        addLine("system", `Available commands:
  help              — Show this help
  clear             — Clear terminal
  sessions          — List active PTY sessions
  new               — Create new PTY session
  close <id>        — Close a PTY session
  exit              — Reset terminal
  <shell command>   — Execute via server shell`);
        return;
      }

      if (trimmed === "clear") {
        setLines(makeLines());
        return;
      }

      if (trimmed === "sessions") {
        setIsLoading(true);
        try {
          const result = await terminalSession({ action: "list" }) as { sessions?: SessionInfo[] };
          const list = result.sessions ?? [];
          if (list.length === 0) {
            addLine("system", "No active PTY sessions. Type 'new' to create one.");
          } else {
            addLine("system", list.map((s) => `  ${s.id}  pid=${s.pid}  cwd=${s.cwd}`).join("\n"));
          }
        } catch (err) {
          addLine("error", `Failed to list sessions: ${(err as Error).message}`);
        } finally {
          setIsLoading(false);
        }
        return;
      }

      if (trimmed === "new") {
        addLine("system", "Creating new PTY session...");
        setIsLoading(true);
        try {
          const result = await terminalSession({ action: "create" }) as { sessionId?: string; pid?: number };
          const sessionId = result.sessionId ?? "unknown";
          const pid = result.pid ?? 0;
          setSessions((prev) => [...prev, { id: sessionId, pid, cwd: "/" }]);
          setActiveSession(sessionId);
          addLine("system", `PTY session created: ${sessionId} (pid=${pid})`);
        } catch (err) {
          addLine("error", `Failed to create PTY session: ${(err as Error).message}`);
        } finally {
          setIsLoading(false);
        }
        return;
      }

      if (trimmed.startsWith("close ")) {
        const targetId = trimmed.slice(6).trim();
        setIsLoading(true);
        try {
          await terminalSession({ action: "close", sessionId: targetId });
          setSessions((prev) => prev.filter((s) => s.id !== targetId));
          if (activeSession === targetId) setActiveSession(null);
          addLine("system", `Session ${targetId} closed.`);
        } catch (err) {
          addLine("error", `Failed to close session: ${(err as Error).message}`);
        } finally {
          setIsLoading(false);
        }
        return;
      }

      // Shell command — call the plugin action
      addLine("input", `$ ${trimmed}`);
      setIsLoading(true);

      try {
        const result = await terminalExec({
          command: trimmed,
          timeoutSec: 60,
        }) as { content?: string; error?: string };

        if (result.error && !result.content) {
          addLine("error", result.error);
        } else {
          const text = result.content ?? "(no output)";
          const hasError = text.includes("SECURITY") || text.includes("Error:");
          addLine(hasError ? "error" : "output", text);
        }
      } catch (err) {
        addLine("error", `Execution failed: ${(err as Error).message}`);
      } finally {
        setIsLoading(false);
      }
    },
    [sessions, activeSession, addLine, terminalExec, terminalSession],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        executeCommand(currentInput);
        setHistory((prev) => [currentInput, ...prev.slice(0, 49)]);
        setHistoryIndex(-1);
        setCurrentInput("");
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const next = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(next);
        setCurrentInput(history[next] ?? "");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = historyIndex - 1;
        if (next < 0) {
          setHistoryIndex(-1);
          setCurrentInput("");
        } else {
          setHistoryIndex(next);
          setCurrentInput(history[next] ?? "");
        }
      } else if (e.key === "Tab") {
        e.preventDefault();
        const cmds = ["help", "clear", "sessions", "new", "exit"];
        const match = cmds.find((c) => c.startsWith(currentInput));
        if (match) setCurrentInput(match);
      } else if (e.key === "l" && e.ctrlKey) {
        e.preventDefault();
        setLines(makeLines());
      }
    },
    [currentInput, historyIndex, history, executeCommand],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#0d1117",
        color: "#e0e0e0",
        fontFamily:
          "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace",
        fontSize: "13px",
        overflow: "hidden",
      }}
      onClick={() => inputRef.current?.focus()}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          borderBottom: "1px solid #21262d",
          background: "#161b22",
          flexShrink: 0,
        }}
      >
        <span style={{ color: "#58a6ff", fontWeight: 600, fontSize: "12px" }}>
          TERM
        </span>
        <span style={{ color: "#484f58", fontSize: "11px" }}>
          bash /bin/bash
        </span>
        {sessions.length > 0 && (
          <span style={{ marginLeft: "auto", color: "#3fb950", fontSize: "11px" }}>
            {sessions.length} PTY session{sessions.length !== 1 ? "s" : ""}
          </span>
        )}
        {isLoading && (
          <span style={{ marginLeft: "auto", color: "#ffd93d", fontSize: "11px" }}>
            ⏳ executing...
          </span>
        )}
      </div>

      {/* Output area */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 12px",
          scrollbarWidth: "thin",
          scrollbarColor: "#30363d transparent",
        }}
      >
        {lines.map((line) => {
          const { color, prefix } = LINE_TYPES[line.type];
          return (
            <div
              key={line.id}
              style={{
                color,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                lineHeight: "1.5",
                minHeight: "19px",
              }}
            >
              {prefix && (
                <span style={{ color: "#484f58", marginRight: "8px" }}>
                  {prefix}
                </span>
              )}
              {line.text}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "8px 12px",
          borderTop: "1px solid #21262d",
          background: "#0d1117",
          flexShrink: 0,
        }}
      >
        <span style={{ color: "#58a6ff", marginRight: "8px", userSelect: "none" }}>
          $
        </span>
        <input
          ref={inputRef}
          value={currentInput}
          onChange={(e) => setCurrentInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          spellCheck={false}
          autoComplete="off"
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#e0e0e0",
            fontFamily: "inherit",
            fontSize: "inherit",
            caretColor: "#58a6ff",
          }}
          placeholder={isLoading ? "executing..." : "type a command or 'help'"}
        />
      </div>
    </div>
  );
}

export { TerminalTab as default };
export { TerminalTab };
