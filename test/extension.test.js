const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../extension.js"), "utf8");
const task = { name: "watch", source: "Workspace", scope: 2, definition: { type: "shell" } };
const execution = (value = task) => ({ task: value, terminated: false, terminate() { this.terminated = true; } });

test("Run and Stop clear the selected task in the Tasks view", async () => {
  const app = setup();
  const [item] = await app.provider.getChildren();
  app.treeView.selection = [item];
  await app.commands.get("explorerTasks.runTask")(item);
  assert.equal(app.treeView.selection.length, 0);
  assert.deepEqual(app.uiCommands, ["explorerTasks.tasksView.focus", "list.clear"]);
  const [running] = await app.provider.getChildren();
  app.treeView.selection = [running];
  await app.commands.get("explorerTasks.stopTask")(running);
  assert.equal(app.treeView.selection.length, 0);
  assert.equal(app.provider.getExecution(running).terminated, true);
});

test("running an unselected task does not change list selection", async () => {
  const app = setup();
  await app.commands.get("explorerTasks.runTask")((await app.provider.getChildren())[0]);
  assert.equal(app.uiCommands.length, 0);
});

test("task detail appears safely in its tooltip", async () => {
  const app = setup();
  app.vscode.tasks.fetchTasks = async () => [{ ...task, detail: "Build *production*" }];
  const [item] = await app.provider.getChildren();
  assert.match(item.tooltip.value, /Build \\\*production\\\*/);
  assert.match(item.tooltip.value, /Click to run/);
});

test("JSON order drives nested groups and leaves, independent of fetch order", async () => {
  const app = setup();
  const names = ["Z / Second", "Plain", "A / Nested / Last", "Z / First", "path/to/file", "Bad /  / Name"];
  const tasks = names.map(name => ({ ...task, name }));
  app.vscode.workspace.getConfiguration = () => ({ inspect: () => ({ workspaceValue: names.map(label => ({ label })) }) });
  app.vscode.tasks.fetchTasks = async () => [...tasks].reverse();
  const roots = await app.provider.getChildren();
  assert.equal(app.contexts.get("explorerTasks.hasTaskGroups"), true);
  assert.equal(app.contexts.get("explorerTasks.treeViewMode"), true);
  assert.equal(app.contexts.get("explorerTasks.groupsExpanded"), true);
  assert.equal(roots.map(item => item.label).join("|"), "Z|Plain|A|path/to/file|Bad /  / Name");
  const children = await app.provider.getChildren(roots[0]);
  assert.equal(children.map(item => item.label).join("|"), "Second|First");
  assert.equal(roots[0].command, undefined);
  const nested = (await app.provider.getChildren(roots[2]))[0];
  const leaf = (await app.provider.getChildren(nested))[0];
  assert.equal(leaf.label, "Last");
  assert.equal(leaf.task.name, "A / Nested / Last");
  await app.commands.get("explorerTasks.runTask")(leaf);
  const refreshed = await app.provider.getChildren();
  assert.equal(refreshed[2].children[0].children[0].running, true);
  assert.equal(refreshed[0].id, roots[0].id);
  assert.equal((await app.provider.getChildren(leaf)).length, 0);
});

test("workspace tasks precede folders, each in JSON order", async () => {
  const app = setup();
  const folders = ["one", "two"].map(name => ({ name, uri: { toString: () => `file:///${name}` } }));
  app.vscode.workspace.workspaceFolders = folders;
  app.vscode.workspace.getConfiguration = () => ({ inspect: () => ({
    workspaceValue: [{ label: "Z" }, { label: "A" }],
    workspaceFolderValue: [{ label: "Z" }, { label: "A" }]
  }) });
  app.vscode.tasks.fetchTasks = async () => [folders[1], folders[0], 2].flatMap(scope =>
    ["A", "Z"].map(name => ({ ...task, name, scope }))
  );
  const items = await app.provider.getChildren();
  assert.equal(items.map(item => `${item.task.scope.name || "workspace"}:${item.label}`).join("|"),
    "workspace:Z|workspace:A|one:Z|one:A|two:Z|two:A");
});

function setup(initial = []) {
  const commands = new Map();
  const errors = [];
  const emitters = [];
  const subscriptions = [];
  const treeView = { selection: [], dispose() {} };
  const uiCommands = [];
  const openedDocuments = [];
  const editor = { selection: undefined, revealRange() {} };
  const contexts = new Map();
  const explorerSettings = { "grouping.expanded": true, viewMode: "tree" };
  let provider, start, end;
  const disposable = () => ({ disposed: false, dispose() { this.disposed = true; } });
  const vscode = {
    TaskScope: { Global: 1, Workspace: 2 },
    ConfigurationTarget: { Workspace: 2 },
    EventEmitter: class {
      constructor() { this.disposed = false; this.listeners = new Set(); emitters.push(this); }
      event = listener => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
      fire() { this.listeners.forEach(listener => listener()); }
      dispose() { this.disposed = true; this.listeners.clear(); }
    },
    TreeItem: class { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class { constructor(id) { this.id = id; } },
    Range: class { constructor(start, end) { this.start = start; this.end = end; } },
    Selection: class { constructor(start, end) { this.start = start; this.end = end; } },
    TextEditorRevealType: { InCenterIfOutsideViewport: 0 },
    MarkdownString: class {
      constructor() { this.value = ""; }
      appendMarkdown(value) { this.value += value; }
    },
    tasks: {
      taskExecutions: [...initial],
      fetchTasks: async () => [task],
      executeTask: async value => {
        const result = execution(value);
        start({ execution: result });
        return result;
      },
      onDidStartTask: callback => { start = callback; return disposable(); },
      onDidEndTask: callback => { end = callback; return disposable(); }
    },
    Uri: { joinPath: (...parts) => parts.join("/") },
    commands: {
      registerCommand: (name, callback) => { commands.set(name, callback); return disposable(); },
      executeCommand: (name, item, value) => {
        if (commands.has(name)) return commands.get(name)(item);
        if (name === "setContext") {
          contexts.set(item, value);
          return;
        }
        uiCommands.push(name);
        if (name === "list.clear") treeView.selection = [];
      }
    },
    window: {
      createTreeView: (_, options) => { provider = options.treeDataProvider; return treeView; },
      showTextDocument: async () => editor,
      showErrorMessage: message => errors.push(message)
    },
    workspace: {
      getConfiguration: section => section === "explorerTasks"
        ? {
            get: (key, fallback) => explorerSettings[key] ?? fallback,
            update: async (key, value) => { explorerSettings[key] = value; }
          }
        : { inspect: () => ({ workspaceValue: [{ label: "watch" }] }) },
      openTextDocument: async uri => {
        openedDocuments.push(uri);
        const text = '{"tasks":[{"label":"watch"}]}';
        return { getText: () => text, positionAt: offset => offset };
      },
      onDidChangeConfiguration: () => disposable(),
      onDidChangeWorkspaceFolders: () => disposable(),
      createFileSystemWatcher: () => ({ ...disposable(), onDidCreate() {}, onDidChange() {}, onDidDelete() {} })
    }
  };
  const sandbox = { require: name => { assert.equal(name, "vscode"); return vscode; }, module: { exports: {} } };
  vm.runInNewContext(source, sandbox);
  sandbox.module.exports.activate({ subscriptions, extensionUri: "extension" });
  return { provider, vscode, commands, contexts, editor, errors, emitters, openedDocuments, subscriptions, treeView, uiCommands,
    start: value => start({ execution: value }), end: value => end({ execution: value }) };
}


for (const preexisting of [false, true]) {
  for (const firstToEnd of [0, 1]) {
    test(`concurrent tasks: preexisting=${preexisting}, firstToEnd=${firstToEnd}`, async () => {
      const active = [execution(), execution()];
      const app = setup(preexisting ? active : []);
      if (!preexisting) active.forEach(app.start);
      app.start(active[0]); // Repeated notification must not count as a new instance.
      app.end(active[firstToEnd]);
      const remaining = active[1 - firstToEnd];
      app.vscode.tasks.taskExecutions = [remaining];
      const [item] = await app.provider.getChildren();
      assert.equal(item.contextValue, "explorerTaskRunning");
      assert.equal(item.command, undefined);
      await app.commands.get("explorerTasks.stopTask")(item);
      assert.equal(remaining.terminated, true);
      app.end(remaining);
      app.vscode.tasks.taskExecutions = [];
      assert.equal((await app.provider.getChildren())[0].contextValue, "explorerTask");
    });
  }
}

test("a task finishing before executeTask resolves stays stopped", async () => {
  const app = setup();
  app.vscode.tasks.executeTask = async () => {
    const active = execution();
    app.start(active);
    app.end(active);
    return active;
  };
  await app.commands.get("explorerTasks.runTask")((await app.provider.getChildren())[0]);
  assert.equal((await app.provider.getChildren())[0].running, false);
});

test("Run delegates to VS Code and start events update the view", async () => {
  const app = setup();
  await app.commands.get("explorerTasks.runTask")((await app.provider.getChildren())[0]);
  const [item] = await app.provider.getChildren();
  assert.equal(item.running, true);
  assert.equal(item.iconPath.id, "sync~spin");
  assert.equal(item.command, undefined);
});

test("resolved task metadata does not split running state", async () => {
  const configured = { ...task, definition: { type: "shell" } };
  const active = ["first", "second"].map(key => execution({
    ...configured,
    source: `resolved-${key}`,
    definition: { type: "shell", _key: key, resolved: key }
  }));
  const app = setup(active);
  app.vscode.tasks.fetchTasks = async () => [configured];
  const [item] = await app.provider.getChildren();
  assert.equal(item.running, true);
  assert.equal(item.label, "watch");
});

test("live VS Code executions are reconciled when start events were missed", async () => {
  const app = setup();
  app.provider.runningTasks.clear();
  app.vscode.tasks.taskExecutions = [execution(), execution()];
  const [item] = await app.provider.getChildren();
  assert.equal(item.running, true);
  assert.equal(item.label, "watch");
});

test("groups can start collapsed", async () => {
  const app = setup();
  const grouped = { ...task, name: "Build / Development" };
  app.vscode.workspace.getConfiguration = section => section === "explorerTasks"
    ? { get: () => false }
    : { inspect: () => ({ workspaceValue: [{ label: grouped.name }] }) };
  app.vscode.tasks.fetchTasks = async () => [grouped];
  const [group] = await app.provider.getChildren();
  assert.equal(group.collapsibleState, app.vscode.TreeItemCollapsibleState.Collapsed);
});

test("Modify opens and reveals the task definition without selecting text", async () => {
  const app = setup();
  await app.commands.get("explorerTasks.modifyTask")({
    task: { ...task, scope: { uri: "file:///workspace" } }
  });
  assert.equal(app.openedDocuments[0], "file:///workspace/.vscode/tasks.json");
  assert.equal(app.editor.selection.start, 19);
  assert.equal(app.editor.selection.end, 19);
});

test("group expansion can be toggled from its command", async () => {
  const app = setup();
  await app.commands.get("explorerTasks.toggleGroupExpansion")();
  assert.equal(
    app.vscode.workspace.getConfiguration("explorerTasks").get("grouping.expanded"),
    false
  );
});

test("grouped tasks can be displayed as a flat list", async () => {
  const app = setup();
  const grouped = { ...task, name: "Build / Development" };
  app.vscode.workspace.getConfiguration = section => section === "explorerTasks"
    ? { get: key => key === "viewMode" ? "flat" : true }
    : { inspect: () => ({ workspaceValue: [{ label: grouped.name }] }) };
  app.vscode.tasks.fetchTasks = async () => [grouped];
  const [item] = await app.provider.getChildren();
  assert.equal(item.label, "Build / Development");
  assert.equal(item.children, undefined);
  assert.equal(app.contexts.get("explorerTasks.hasTaskGroups"), true);
});

test("view mode can be toggled from its command", async () => {
  const app = setup();
  await app.commands.get("explorerTasks.toggleViewMode")();
  assert.equal(
    app.vscode.workspace.getConfiguration("explorerTasks").get("viewMode"),
    "flat"
  );
});

test("state-specific view commands set explicit states", async () => {
  const app = setup();
  const configuration = app.vscode.workspace.getConfiguration("explorerTasks");
  await app.commands.get("explorerTasks.collapseGroups")();
  assert.equal(configuration.get("grouping.expanded"), false);
  await app.commands.get("explorerTasks.expandGroups")();
  assert.equal(configuration.get("grouping.expanded"), true);
  await app.commands.get("explorerTasks.showFlatView")();
  assert.equal(configuration.get("viewMode"), "flat");
  await app.commands.get("explorerTasks.showTreeView")();
  assert.equal(configuration.get("viewMode"), "tree");
});

test("tasks with the same name in different folders remain independent", async () => {
  const app = setup();
  const tasks = ["one", "two"].map(name => ({ ...task, scope: { name, uri: { toString: () => `file:///${name}` } } }));
  app.vscode.tasks.fetchTasks = async () => tasks;
  app.start(execution(tasks[0]));
  const items = await app.provider.getChildren();
  assert.equal(items[0].running, true);
  assert.equal(items[1].running, false);
  assert.equal(items[1].task.scope.name, "two");
  assert.equal(items[1].description, undefined);
});

test("definition property order does not change task identity", async () => {
  const app = setup();
  app.vscode.tasks.fetchTasks = async () => [{ ...task, definition: { type: "npm", script: "dev" } }];
  app.start(execution({ ...task, definition: { script: "dev", type: "npm" } }));
  assert.equal((await app.provider.getChildren())[0].running, true);
});

test("load and execution failures are shown to the user", async () => {
  const app = setup();
  app.vscode.tasks.fetchTasks = async () => { throw Error("load failed"); };
  assert.equal((await app.provider.getChildren()).length, 0);
  assert.match(app.errors[0], /load failed/);
  app.vscode.tasks.executeTask = async () => { throw Error("run failed"); };
  await app.commands.get("explorerTasks.runTask")({ task });
  assert.match(app.errors[1], /run failed/);
});

test("activation resources include provider cleanup", () => {
  const app = setup([execution()]);
  app.subscriptions.forEach(resource => resource.dispose());
  assert(app.emitters.every(emitter => emitter.disposed));
  assert.equal(app.provider.runningTasks.size, 0);
});

test("Run stays in the context menu while Stop and Modify remain inline", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  for (const command of ["explorerTasks.runTask", "explorerTasks.stopTask", "explorerTasks.modifyTask"]) {
    assert(manifest.contributes.menus.commandPalette.some(entry => entry.command === command && entry.when === "false"));
    assert(manifest.contributes.menus["view/item/context"].some(entry => entry.command === command));
  }
  const itemMenus = manifest.contributes.menus["view/item/context"];
  assert(!itemMenus.find(entry => entry.command === "explorerTasks.runTask").group.startsWith("inline"));
  assert(itemMenus.find(entry => entry.command === "explorerTasks.stopTask").group.startsWith("inline"));
  assert(itemMenus.find(entry => entry.command === "explorerTasks.modifyTask").group.startsWith("inline"));
  assert(!manifest.contributes.menus.commandPalette.some(entry => entry.command === "explorerTasks.refresh"));
  const commands = new Map(manifest.contributes.commands.map(command => [command.command, command]));
  assert.equal(commands.get("explorerTasks.expandGroups").icon, "$(expand-all)");
  assert.equal(commands.get("explorerTasks.collapseGroups").icon, "$(collapse-all)");
  assert.equal(commands.get("explorerTasks.showFlatView").icon, "$(list-flat)");
  assert.equal(commands.get("explorerTasks.showTreeView").icon, "$(list-tree)");
  assert(manifest.contributes.menus["view/title"]
    .filter(entry => /Groups|View/.test(entry.command))
    .every(entry => !entry.when.includes("config.explorerTasks")));
  assert(manifest.contributes.viewsWelcome.some(entry =>
    entry.view === "explorerTasks.tasksView" && !entry.contents.includes("command:")
  ));
});

test("only explicitly configured project tasks are listed", async () => {
  const app = setup();
  app.vscode.workspace.getConfiguration = () => ({ inspect: () => ({
    workspaceValue: [{ label: "watch", type: "shell" }, { type: "npm", script: "dev" }],
    globalValue: [{ label: "user task" }]
  }) });
  app.vscode.tasks.fetchTasks = async () => [
    task,
    { ...task, scope: 1 },
    { ...task, name: "user task", scope: 1 },
    { ...task, name: "npm: dev", source: "npm", definition: { type: "npm", script: "dev" } },
    { ...task, name: "npm: test", source: "npm", definition: { type: "npm", script: "test" } }
  ];
  const items = await app.provider.getChildren();
  assert.equal(items.length, 2);
  assert.equal(items[0].task.name, "watch");
  assert.equal(items[1].task.name, "npm: dev");
});

test("no project configuration hides all tasks, including global configuration", async () => {
  const app = setup();
  app.vscode.workspace.getConfiguration = () => ({ inspect: () => ({ globalValue: [{ label: "watch" }] }) });
  assert.equal((await app.provider.getChildren()).length, 0);
});

test("folder task definitions do not leak across workspace folders", async () => {
  const app = setup();
  const one = { name: "one", uri: { toString: () => "file:///one" } };
  const two = { name: "two", uri: { toString: () => "file:///two" } };
  app.vscode.workspace.getConfiguration = (_, uri) => ({ inspect: () => ({
    workspaceFolderValue: uri === one.uri ? [{ label: "watch", type: "shell" }] : []
  }) });
  app.vscode.tasks.fetchTasks = async () => [{ ...task, scope: one }, { ...task, scope: two }];
  const items = await app.provider.getChildren();
  assert.equal(items.length, 1);
  assert.equal(items[0].task.scope.name, "one");
});
