/**
 * A small, stateful stand-in for the `vscode` module, wired in through the
 * vitest alias in vitest.config.ts. It lets unit tests run activate(), the MCP
 * provider and the sign-in glue in plain node, and inspect what they did:
 * registered commands, context keys, toasts, clipboard, opened URLs, config.
 *
 * Only the API surface this extension touches is modelled, and only as far as
 * the tests need. Tests call `vi.resetModules()` and re-import, so every test
 * gets a fresh instance of this module and of the extension modules together
 * (see test/helpers.ts).
 *
 * NOT shipped: test/** is excluded from the .vsix (.vscodeignore) and from tsc
 * (rootDir is src/).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- basic types -----------------------------------------------------------

export class Disposable {
  private fn: (() => void) | undefined;
  constructor(fn: () => void) {
    this.fn = fn;
  }
  static from(...items: { dispose(): unknown }[]): Disposable {
    return new Disposable(() => items.forEach((i) => i.dispose()));
  }
  dispose(): void {
    const f = this.fn;
    this.fn = undefined;
    f?.();
  }
}

export class EventEmitter<T> {
  private listeners = new Set<(e: T) => void>();
  fireCount = 0;
  event = (listener: (e: T) => void): Disposable => {
    this.listeners.add(listener);
    return new Disposable(() => this.listeners.delete(listener));
  };
  fire(e: T): void {
    this.fireCount++;
    for (const l of [...this.listeners]) l(e);
  }
  dispose(): void {
    this.listeners.clear();
  }
}

export class CancellationError extends Error {
  constructor() {
    super("Canceled");
    this.name = "Canceled";
  }
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly authority: string,
    readonly path: string,
    readonly query: string,
    readonly fragment: string,
    private readonly raw: string,
  ) {}
  static parse(value: string): Uri {
    const u = new URL(value);
    return new Uri(u.protocol.replace(/:$/, ""), u.host, u.pathname, u.search.replace(/^\?/, ""), u.hash.replace(/^#/, ""), value);
  }
  static file(fsPath: string): Uri {
    return new Uri("file", "", fsPath, "", "", `file://${fsPath}`);
  }
  get fsPath(): string {
    return this.path;
  }
  toString(): string {
    return this.raw;
  }
}

export class McpStdioServerDefinition {
  cwd?: Uri;
  constructor(
    readonly label: string,
    public command: string,
    public args: string[] = [],
    public env: Record<string, string | number | null> = {},
    public version?: string,
  ) {}
}

export class McpHttpServerDefinition {
  constructor(
    readonly label: string,
    public uri: Uri,
    public headers: Record<string, string> = {},
    public version?: string,
  ) {}
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}
export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}
export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}
export enum QuickPickItemKind {
  Separator = -1,
  Default = 0,
}

export const version = "1.102.0";

// ---- recorded state ----------------------------------------------------------

export interface ShownMessage {
  level: "info" | "warning" | "error";
  message: string;
  items: string[];
}

type Responder = (m: ShownMessage) => string | undefined | Promise<string | undefined>;

export const __state = {
  messages: [] as ShownMessage[],
  commands: new Map<string, (...args: any[]) => any>(),
  /** Commands that "exist in the host" (e.g. Cursor settings); called by executeCommand. */
  externalCommands: new Map<string, (...args: any[]) => any>(),
  executed: [] as { id: string; args: any[] }[],
  context: new Map<string, unknown>(),
  opened: [] as string[],
  clipboard: "",
  uriHandlers: [] as { handleUri(uri: Uri): unknown }[],
  statusItems: [] as any[],
  logLines: [] as string[],
  config: new Map<string, unknown>(),
  configListeners: new Set<(e: { affectsConfiguration(s: string): boolean }) => void>(),
  lmProviders: new Map<string, any>(),
  respond: (() => undefined) as Responder,
  inputBox: (() => undefined) as (opts: any) => string | undefined | Promise<string | undefined>,
  quickPick: ((items: any[]) => undefined) as (items: any[], opts: any) => any,
  windowStateListeners: new Set<(e: { focused: boolean }) => void>(),
};

/** Simulate the editor window gaining or losing focus. */
export function __fireWindowState(focused: boolean): void {
  for (const l of [...__state.windowStateListeners]) l({ focused });
}

/** Decide what each toast "returns" (which button the user clicked). */
export function __setResponder(fn: Responder): void {
  __state.respond = fn;
}

// ---- window ------------------------------------------------------------------

function show(level: ShownMessage["level"], message: string, rest: any[]): Promise<string | undefined> {
  // VS Code accepts (message, ...items) or (message, options, ...items).
  const items = rest.filter((r) => typeof r === "string");
  const m: ShownMessage = { level, message, items };
  __state.messages.push(m);
  return Promise.resolve(__state.respond(m));
}

export const window = {
  onDidChangeWindowState(listener: (e: { focused: boolean }) => void): Disposable {
    __state.windowStateListeners.add(listener);
    return new Disposable(() => __state.windowStateListeners.delete(listener));
  },
  createOutputChannel(_name: string, _opts?: unknown) {
    const push = (lvl: string) => (msg: string) => __state.logLines.push(`[${lvl}] ${msg}`);
    return {
      info: push("info"),
      warn: push("warn"),
      error: push("error"),
      debug: push("debug"),
      trace: push("trace"),
      appendLine: push("line"),
      append: push("line"),
      show: () => undefined,
      hide: () => undefined,
      clear: () => undefined,
      dispose: () => undefined,
    };
  },
  showInformationMessage: (message: string, ...rest: any[]) => show("info", message, rest),
  showWarningMessage: (message: string, ...rest: any[]) => show("warning", message, rest),
  showErrorMessage: (message: string, ...rest: any[]) => show("error", message, rest),
  showInputBox: (opts: any) => Promise.resolve(__state.inputBox(opts)),
  showQuickPick: (items: any[], opts: any) => Promise.resolve(__state.quickPick(items, opts)),
  registerUriHandler(handler: { handleUri(uri: Uri): unknown }): Disposable {
    __state.uriHandlers.push(handler);
    return new Disposable(() => undefined);
  },
  withProgress<R>(_opts: unknown, task: (p: unknown, token: any) => Thenable<R>): Thenable<R> {
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: () => new Disposable(() => undefined),
    };
    return task({ report: () => undefined }, token);
  },
  createStatusBarItem(id?: string, alignment?: StatusBarAlignment, priority?: number) {
    const item = {
      id,
      alignment,
      priority,
      name: "",
      text: "",
      tooltip: "" as unknown,
      command: undefined as unknown,
      visible: false,
      show() {
        item.visible = true;
      },
      hide() {
        item.visible = false;
      },
      dispose() {
        item.visible = false;
      },
    };
    __state.statusItems.push(item);
    return item;
  },
};

// ---- commands ----------------------------------------------------------------

export const commands = {
  registerCommand(id: string, fn: (...args: any[]) => any): Disposable {
    if (__state.commands.has(id)) {
      throw new Error(`command '${id}' already exists`);
    }
    __state.commands.set(id, fn);
    return new Disposable(() => __state.commands.delete(id));
  },
  async executeCommand(id: string, ...args: any[]): Promise<any> {
    __state.executed.push({ id, args });
    if (id === "setContext") {
      __state.context.set(args[0], args[1]);
      return undefined;
    }
    const fn = __state.commands.get(id) ?? __state.externalCommands.get(id);
    if (!fn) {
      throw new Error(`command '${id}' not found`);
    }
    return fn(...args);
  },
  async getCommands(_filterInternal?: boolean): Promise<string[]> {
    return [...__state.commands.keys(), ...__state.externalCommands.keys()];
  },
};

// ---- env ---------------------------------------------------------------------

export const env = {
  appName: "Visual Studio Code",
  uriScheme: "vscode",
  async openExternal(uri: Uri): Promise<boolean> {
    __state.opened.push(uri.toString());
    return true;
  },
  clipboard: {
    async writeText(text: string): Promise<void> {
      __state.clipboard = text;
    },
    async readText(): Promise<string> {
      return __state.clipboard;
    },
  },
};

// ---- workspace -----------------------------------------------------------------

export const workspace = {
  workspaceFolders: undefined as { uri: Uri; name: string; index: number }[] | undefined,
  getConfiguration(section?: string) {
    const full = (key: string) => (section ? `${section}.${key}` : key);
    return {
      get<T>(key: string, defaultValue?: T): T | undefined {
        const k = full(key);
        return __state.config.has(k) ? (__state.config.get(k) as T) : defaultValue;
      },
      async update(key: string, value: unknown, _target?: ConfigurationTarget): Promise<void> {
        const k = full(key);
        __state.config.set(k, value);
        const e = { affectsConfiguration: (s: string) => k === s || k.startsWith(`${s}.`) };
        for (const l of [...__state.configListeners]) l(e);
      },
    };
  },
  onDidChangeConfiguration(listener: (e: { affectsConfiguration(s: string): boolean }) => void): Disposable {
    __state.configListeners.add(listener);
    return new Disposable(() => __state.configListeners.delete(listener));
  },
};

// ---- lm and cursor (reassignable: hosts differ) --------------------------------

function defaultLm() {
  return {
    registerMcpServerDefinitionProvider(id: string, provider: any): Disposable {
      __state.lmProviders.set(id, provider);
      return new Disposable(() => __state.lmProviders.delete(id));
    },
  };
}

export let lm: any = defaultLm();
export let cursor: any = undefined;

/** Model a host: its name, scheme, and which MCP APIs it exposes. */
export function __setHost(opts: { appName: string; uriScheme: string; lm?: "real" | "stub" | "absent"; cursor?: any }): void {
  env.appName = opts.appName;
  env.uriScheme = opts.uriScheme;
  switch (opts.lm ?? "real") {
    case "real":
      lm = defaultLm();
      break;
    case "stub":
      // Cursor 3.21: logs a warning and returns a no-op disposable.
      lm = { registerMcpServerDefinitionProvider: () => new Disposable(() => undefined) };
      break;
    case "absent":
      lm = undefined;
      break;
  }
  cursor = opts.cursor;
}

// ---- ExtensionContext factory ----------------------------------------------------

export function __makeContext(opts: { version?: string; globalState?: Record<string, unknown> } = {}) {
  const secrets = new Map<string, string>();
  const global = new Map<string, unknown>(Object.entries(opts.globalState ?? {}));
  return {
    subscriptions: [] as { dispose(): unknown }[],
    secrets: {
      get: async (k: string) => secrets.get(k),
      store: async (k: string, v: string) => {
        secrets.set(k, v);
      },
      delete: async (k: string) => {
        secrets.delete(k);
      },
      onDidChange: () => new Disposable(() => undefined),
    },
    globalState: {
      get: <T>(k: string, d?: T) => (global.has(k) ? (global.get(k) as T) : d),
      update: async (k: string, v: unknown) => {
        if (v === undefined) global.delete(k);
        else global.set(k, v);
      },
      keys: () => [...global.keys()],
      setKeysForSync: (_keys: string[]) => undefined,
    },
    extension: { id: "Mnemoverse.mnemoverse-vscode", packageJSON: { version: opts.version ?? "0.3.0" } },
    /** Test access to the raw stores. */
    __secrets: secrets,
    __global: global,
  };
}
