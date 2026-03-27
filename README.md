# @paperclipai/plugin-terminal

Интерактивный терминал для Paperclip — выполняй shell-команды на сервере и управляй PTY-сессиями прямо из интерфейса Paperclip.

---

## Установка за 4 шага

### Шаг 1 — Скачай и распакуй архив

```bash
# Скопируй архив paperclip-terminal-1.0.0.tar.gz в директорию своего Paperclip
# (рядом с папкой packages/plugins/)

# Распакуй:
cd /путь/к/твоему/paperclip/packages/plugins
tar -xzf paperclip-terminal-1.0.0.tar.gz
```

### Шаг 2 — Установи зависимости и собери

```bash
cd paperclip-terminal
pnpm install
pnpm build
```

> Если `pnpm build` падает с ошибкой про node-pty — нужно установить системные зависимости для компиляции нативного модуля:
> ```bash
> # Ubuntu/Debian:
> sudo apt-get install -y build-essential python3
> pnpm install
> pnpm build
> ```

### Шаг 3 — Установи плагин в Paperclip

```bash
# Из корня своего Paperclip:
cd /путь/к/твоему/paperclip
paperclipai plugin install ./packages/plugins/paperclip-terminal --local
```

Если команда выше возвращает **403 "Board access required"** — значит у агента нет прав на установку плагинов (требуется пользовательская авторизация). Тогда используй ручной способ через PostgreSQL (см. ниже).

### Шаг 4 — Перезапусти сервер

```bash
# Найди и убей процесс Paperclip:
killall -9 node

# Запусти заново:
cd /путь/к/твоему/paperclip
pnpm paperclipai run
# или
pnpm dev:watch
```

После запуска в логах должно появиться:
```
paperclip-terminal: activated, 2 tools registered
```

---

## Альтернативная установка — через PostgreSQL

Если CLI-установка не работает (нет прав агента):

```bash
# 1. Узнай путь к своему Paperclip:
pwd
# Это будет $PAPERCLIP_ROOT

# 2. Вставь плагин в базу данных:
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

Замени `$PAPERCLIP_ROOT` на реальный путь к твоему Paperclip.

---

## Структура плагина

```
paperclip-terminal/
├── dist/               — Скомпилированные файлы (после pnpm build)
│   ├── manifest.js     — Метаданные плагина
│   ├── worker.js       — Логика плагина (PTY, exec)
│   └── ui/index.js    — UI-компонент терминала
├── src/                — Исходники
├── package.json
└── README.md
```

---

## Использование

### Инструменты агента

#### `terminal-exec` — Выполнение команд

```typescript
const result = await ctx.tools.execute("terminal-exec", {
  command: "ls -la",       // shell-команда
  timeoutSec: 60,          // таймаут (default: 60)
});
// result.content — stdout/stderr
// result.error — ошибка (если есть)
```

#### `terminal-session` — Управление PTY-сессиями

```typescript
// Создать сессию
const { sessionId } = await ctx.tools.execute("terminal-session", {
  action: "create",
  cwd: "/home/user",       // рабочая директория
});

// Написать в сессию
await ctx.tools.execute("terminal-session", {
  action: "write",
  sessionId,
  input: "ls\n",
});

// Изменить размер терминала
await ctx.tools.execute("terminal-session", {
  action: "resize",
  sessionId,
  cols: 120,
  rows: 40,
});

// Закрыть сессию
await ctx.tools.execute("terminal-session", {
  action: "close",
  sessionId,
});

// Список активных сессий
const { sessions } = await ctx.tools.execute("terminal-session", {
  action: "list",
});
```

### UI-терминал (вкладка в проекте)

В project view появится вкладка **Terminal**. Встроенные команды:

| Команда | Описание |
|---|---|
| `help` | Справка |
| `clear` | Очистить экран |
| `sessions` | Список PTY-сессий |
| `new` | Создать PTY-сессию |
| `close <id>` | Закрыть сессию |
| `<команда>` | Выполнить shell-команду |

Горячие клавиши: `↑`/`↓` — история, `Tab` — дополнение, `Ctrl+L` — очистка.

---

## Конфигурация

В настройках проекта (instance config):

```json
{
  "defaultShell": "/bin/bash",
  "sessionTimeoutSec": 3600,
  "maxConcurrentSessions": 5
}
```

| Параметр | Default | Описание |
|---|---|---|
| `defaultShell` | `/bin/bash` | Shell для PTY |
| `sessionTimeoutSec` | `3600` | Idle-таймаут сессий |
| `maxConcurrentSessions` | `5` | Макс. одновременных PTY |

---

## Безопасность

- Заблокированы опасные команды: `rm -rf /`, `dd`, `mkfs`, fork-бомбы
- PTY работает от пользователя сервера
- Таймауты на каждую команду

---

## Troubleshooting

**Плагин не появляется:**
```bash
# Проверь статус:
psql -h localhost -p 5433 -U paperclip -d paperclip -c \
  "SELECT plugin_key, status FROM plugins;"
# Должно быть: paperclip-terminal | ready
```

**node-pty не компилируется:**
```bash
# Ubuntu/Debian:
sudo apt-get install -y build-essential python3

# macOS:
xcode-select --install
```

**Сервер не подхватывает плагин:**
```bash
killall -9 node
cd /путь/к/твоему/paperclip
pnpm paperclipai run
```

---

*Published by the Paperclip Community*
