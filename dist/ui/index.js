// src/ui/index.tsx
import { useState, useEffect, useRef, useCallback } from "react";
import { usePluginAction, useHostContext } from "@paperclipai/plugin-sdk/ui";
import { jsx, jsxs } from "react/jsx-runtime";
var LINE_TYPES = {
  input: { color: "#a8dadc", prefix: "$" },
  output: { color: "#e0e0e0", prefix: "" },
  error: { color: "#ff6b6b", prefix: "\u2717" },
  system: { color: "#ffd93d", prefix: "\u25CF" }
};
function makeLines() {
  return [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "system",
      text: "Paperclip Terminal v1.0.0 \u2014 Server Shell Access",
      timestamp: Date.now()
    },
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "system",
      text: "Interactive terminal. Type 'help' for commands.",
      timestamp: Date.now()
    }
  ];
}
function TerminalTab(_props) {
  const { entityId: projectId, companyId } = useHostContext();
  const terminalExec = usePluginAction("terminal-exec");
  const terminalSession = usePluginAction("terminal-session");
  const [lines, setLines] = useState(makeLines);
  const [currentInput, setCurrentInput] = useState("");
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);
  const addLine = useCallback(
    (type, text) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setLines((prev) => [...prev, { id, type, text, timestamp: Date.now() }]);
    },
    []
  );
  const executeCommand = useCallback(
    async (cmd) => {
      const trimmed = cmd.trim();
      if (!trimmed) return;
      if (trimmed === "help") {
        addLine("system", `Available commands:
  help              \u2014 Show this help
  clear             \u2014 Clear terminal
  sessions          \u2014 List active PTY sessions
  new               \u2014 Create new PTY session
  close <id>        \u2014 Close a PTY session
  exit              \u2014 Reset terminal
  <shell command>   \u2014 Execute via server shell`);
        return;
      }
      if (trimmed === "clear") {
        setLines(makeLines());
        return;
      }
      if (trimmed === "sessions") {
        setIsLoading(true);
        try {
          const result = await terminalSession({ action: "list" });
          const list = result.sessions ?? [];
          if (list.length === 0) {
            addLine("system", "No active PTY sessions. Type 'new' to create one.");
          } else {
            addLine("system", list.map((s) => `  ${s.id}  pid=${s.pid}  cwd=${s.cwd}`).join("\n"));
          }
        } catch (err) {
          addLine("error", `Failed to list sessions: ${err.message}`);
        } finally {
          setIsLoading(false);
        }
        return;
      }
      if (trimmed === "new") {
        addLine("system", "Creating new PTY session...");
        setIsLoading(true);
        try {
          const result = await terminalSession({ action: "create" });
          const sessionId = result.sessionId ?? "unknown";
          const pid = result.pid ?? 0;
          setSessions((prev) => [...prev, { id: sessionId, pid, cwd: "/" }]);
          setActiveSession(sessionId);
          addLine("system", `PTY session created: ${sessionId} (pid=${pid})`);
        } catch (err) {
          addLine("error", `Failed to create PTY session: ${err.message}`);
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
          addLine("error", `Failed to close session: ${err.message}`);
        } finally {
          setIsLoading(false);
        }
        return;
      }
      addLine("input", `$ ${trimmed}`);
      setIsLoading(true);
      try {
        const result = await terminalExec({
          command: trimmed,
          timeoutSec: 60
        });
        if (result.error && !result.content) {
          addLine("error", result.error);
        } else {
          const text = result.content ?? "(no output)";
          const hasError = text.includes("SECURITY") || text.includes("Error:");
          addLine(hasError ? "error" : "output", text);
        }
      } catch (err) {
        addLine("error", `Execution failed: ${err.message}`);
      } finally {
        setIsLoading(false);
      }
    },
    [sessions, activeSession, addLine, terminalExec, terminalSession]
  );
  const handleKeyDown = useCallback(
    (e) => {
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
    [currentInput, historyIndex, history, executeCommand]
  );
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#0d1117",
        color: "#e0e0e0",
        fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace",
        fontSize: "13px",
        overflow: "hidden"
      },
      onClick: () => inputRef.current?.focus(),
      children: [
        /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 12px",
              borderBottom: "1px solid #21262d",
              background: "#161b22",
              flexShrink: 0
            },
            children: [
              /* @__PURE__ */ jsx("span", { style: { color: "#58a6ff", fontWeight: 600, fontSize: "12px" }, children: "TERM" }),
              /* @__PURE__ */ jsx("span", { style: { color: "#484f58", fontSize: "11px" }, children: "bash /bin/bash" }),
              sessions.length > 0 && /* @__PURE__ */ jsxs("span", { style: { marginLeft: "auto", color: "#3fb950", fontSize: "11px" }, children: [
                sessions.length,
                " PTY session",
                sessions.length !== 1 ? "s" : ""
              ] }),
              isLoading && /* @__PURE__ */ jsx("span", { style: { marginLeft: "auto", color: "#ffd93d", fontSize: "11px" }, children: "\u23F3 executing..." })
            ]
          }
        ),
        /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              flex: 1,
              overflowY: "auto",
              padding: "8px 12px",
              scrollbarWidth: "thin",
              scrollbarColor: "#30363d transparent"
            },
            children: [
              lines.map((line) => {
                const { color, prefix } = LINE_TYPES[line.type];
                return /* @__PURE__ */ jsxs(
                  "div",
                  {
                    style: {
                      color,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      lineHeight: "1.5",
                      minHeight: "19px"
                    },
                    children: [
                      prefix && /* @__PURE__ */ jsx("span", { style: { color: "#484f58", marginRight: "8px" }, children: prefix }),
                      line.text
                    ]
                  },
                  line.id
                );
              }),
              /* @__PURE__ */ jsx("div", { ref: bottomRef })
            ]
          }
        ),
        /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              padding: "8px 12px",
              borderTop: "1px solid #21262d",
              background: "#0d1117",
              flexShrink: 0
            },
            children: [
              /* @__PURE__ */ jsx("span", { style: { color: "#58a6ff", marginRight: "8px", userSelect: "none" }, children: "$" }),
              /* @__PURE__ */ jsx(
                "input",
                {
                  ref: inputRef,
                  value: currentInput,
                  onChange: (e) => setCurrentInput(e.target.value),
                  onKeyDown: handleKeyDown,
                  disabled: isLoading,
                  spellCheck: false,
                  autoComplete: "off",
                  style: {
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "#e0e0e0",
                    fontFamily: "inherit",
                    fontSize: "inherit",
                    caretColor: "#58a6ff"
                  },
                  placeholder: isLoading ? "executing..." : "type a command or 'help'"
                }
              )
            ]
          }
        )
      ]
    }
  );
}
export {
  TerminalTab,
  TerminalTab as default
};
//# sourceMappingURL=index.js.map
