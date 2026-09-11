const vscode = require("vscode");
const {
  applyEdits,
  modify
} = require("jsonc-parser");
const {
  STARTER_TASK_CONFIGURATION,
  findTaskDefinition,
  parseTaskConfiguration,
  revealConfigurationPath,
  revealTaskDefinition
} = require("./task-configuration");
const {
  configuredTaskIcon,
  createProjectTaskMatcher,
  taskKey
} = require("./task-model");
const { buildTree, hasGroupPath } = require("./task-tree");

class TasksProvider {
  constructor(workspaceState) {
    this.workspaceState = workspaceState;
    this.showHidden = workspaceState.get("showHiddenTasks", false);
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    this.runningTasks = new Map();
    this.loadPromise = undefined;
    this.refreshPending = false;
    this.refreshTimer = undefined;
    this.disposed = false;
    this.contextValues = new Map();
    this.currentProjectTaskKeys = new Set();
    this.trackedRunningTaskKeys = new Set();
    this.duplicateLabelsSignature = undefined;

    // Pick up tasks that were already running before
    // this view/extension was activated.
    for (const execution of vscode.tasks.taskExecutions) {
      this.markRunning(execution);
    }
  }

  refresh() {
    if (this.disposed) return;

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    if (this.loadPromise) {
      this.refreshPending = true;
      return;
    }

    this._onDidChangeTreeData.fire();
  }

  scheduleRefresh() {
    if (this.disposed || this.refreshTimer) return;

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.refresh();
    }, 25);
  }

  dispose() {
    this.disposed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.refreshPending = false;
    this._onDidChangeTreeData.dispose();
    this.runningTasks.clear();
    this.contextValues.clear();
    this.currentProjectTaskKeys.clear();
    this.trackedRunningTaskKeys.clear();
  }

  async getChildren(element) {
    if (element) {
      return element.children || [];
    }

    if (this.loadPromise) return this.loadPromise;

    const loadPromise = this.loadRootChildren();
    this.loadPromise = loadPromise;

    try {
      return await loadPromise;
    } finally {
      if (this.loadPromise === loadPromise) {
        this.loadPromise = undefined;

        if (this.refreshPending) {
          this.refreshPending = false;
          this.refresh();
        }
      }
    }
  }

  async loadRootChildren() {
    try {
      const tasks = await vscode.tasks.fetchTasks();
      const matchProjectTask = createProjectTaskMatcher(vscode);
      const executionsByTask = this.snapshotExecutions();

      const matched = tasks
        .map(task => ({ task, key: taskKey(task), ...matchProjectTask(task) }))
        .filter(entry => entry.index >= 0);
      const duplicateLabels = matched.filter(entry => entry.duplicateLabel);
      this.reportDuplicateLabels(duplicateLabels);

      const seenDuplicateKeys = new Set();
      const ordered = matched
        .filter(entry => {
          if (!entry.duplicateLabel) return true;
          if (seenDuplicateKeys.has(entry.key)) return false;
          seenDuplicateKeys.add(entry.key);
          return true;
        })
        .sort((a, b) => scopeOrder(a.task) - scopeOrder(b.task) || a.index - b.index);
      this.currentProjectTaskKeys = new Set(ordered.map(({ key }) => key));

      for (const key of this.currentProjectTaskKeys) {
        if (executionsByTask.has(key)) this.trackedRunningTaskKeys.add(key);
      }

      const hasHiddenTasks = ordered.some(({ definition }) => definition?.hide === true);
      const displayed = this.showHidden
        ? ordered
        : ordered.filter(({ key, definition, duplicateLabel }) =>
            definition?.hide !== true || executionsByTask.has(key) || duplicateLabel
          );

      const hasTaskGroups = displayed.some(({ task }) => hasGroupPath(task.name));
      const mode = viewMode();
      const groupsExpanded = groupsExpandedByDefault();
      const hasTaskConfiguration = await taskConfigurationExists();
      await this.updateContexts({
        "explorerTasks.hasHiddenTasks": hasHiddenTasks,
        "explorerTasks.showHiddenTasks": this.showHidden,
        "explorerTasks.hasTaskGroups": hasTaskGroups,
        "explorerTasks.treeViewMode": mode === "tree",
        "explorerTasks.groupsExpanded": groupsExpanded,
        "explorerTasks.hasTaskConfiguration": hasTaskConfiguration
      });

      const items = displayed.map(({ task, key, definition, duplicateLabel }) => {
        return new TaskItem(
          task,
          key,
          !duplicateLabel && executionsByTask.has(key),
          configuredTaskIcon(definition),
          definition?.hide === true,
          false,
          duplicateLabel
        );
      });
      const orphanItems = [];

      for (const key of this.trackedRunningTaskKeys) {
        if (this.currentProjectTaskKeys.has(key)) continue;

        const executions = executionsByTask.get(key);
        const execution = executions?.values().next().value;

        if (!execution) {
          this.trackedRunningTaskKeys.delete(key);
          continue;
        }

        orphanItems.push(new TaskItem(
          execution.task,
          key,
          true,
          undefined,
          false,
          true
        ));
      }

      return mode === "flat"
        ? [...items, ...orphanItems]
        : [...buildTree(vscode, items, groupsExpanded), ...orphanItems];
    } catch (error) {
      vscode.window.showErrorMessage(
        `Could not load tasks: ${error.message || error}`
      );

      return [];
    }
  }

  getTreeItem(element) {
    return element;
  }

  markRunning(execution) {
    const key = taskKey(execution.task);
    let executions = this.runningTasks.get(key);

    if (!executions) {
      executions = new Set();
      this.runningTasks.set(key, executions);
    }

    executions.add(execution);
    if (this.currentProjectTaskKeys.has(key)) {
      this.trackedRunningTaskKeys.add(key);
    }

    this.refresh();
  }

  markStopped(execution) {
    const key = taskKey(execution.task);
    const executions = this.runningTasks.get(key);

    if (executions) {
      executions.delete(execution);

      if (executions.size === 0) {
        this.runningTasks.delete(key);
        this.trackedRunningTaskKeys.delete(key);
      }
    }

    this.refresh();
  }

  getExecution(item) {
    return (
      this.runningTasks.get(item.key)?.values().next().value ||
      vscode.tasks.taskExecutions.find(
        execution =>
          taskKey(execution.task) === item.key
      )
    );
  }

  snapshotExecutions() {
    const executionsByTask = new Map();

    for (const [key, executions] of this.runningTasks) {
      if (executions.size > 0) {
        executionsByTask.set(key, new Set(executions));
      }
    }

    for (const execution of vscode.tasks.taskExecutions) {
      const key = taskKey(execution.task);
      let executions = executionsByTask.get(key);

      if (!executions) {
        executions = new Set();
        executionsByTask.set(key, executions);
      }

      executions.add(execution);
    }

    return executionsByTask;
  }

  async updateContexts(values) {
    const changes = Object.entries(values).filter(
      ([key, value]) => this.contextValues.get(key) !== value
    );

    await Promise.all(changes.map(async ([key, value]) => {
      await vscode.commands.executeCommand("setContext", key, value);
      this.contextValues.set(key, value);
    }));
  }

  async setShowHidden(value) {
    this.showHidden = value;
    await this.workspaceState.update("showHiddenTasks", value);
    this.refresh();
  }

  reportDuplicateLabels(entries) {
    const duplicates = [...new Map(entries.map(entry => [entry.key, entry.task])).values()];
    const signature = duplicates.map(taskKey).sort().join("\n");

    if (!signature) {
      this.duplicateLabelsSignature = undefined;
      return;
    }

    if (signature === this.duplicateLabelsSignature) return;
    this.duplicateLabelsSignature = signature;

    const descriptions = duplicates.map(task => {
      const scope = typeof task.scope === "object"
        ? `workspace folder "${task.scope.name || task.scope.uri.toString()}"`
        : "workspace";
      return `"${task.name}" in the ${scope}`;
    });

    vscode.window.showErrorMessage(
      `Explorer Tasks requires task labels to be unique within each workspace scope. ` +
      `Duplicate ${descriptions.length === 1 ? "label" : "labels"}: ${descriptions.join(", ")}. ` +
      `Rename ${descriptions.length === 1 ? "one of the tasks" : "the duplicated tasks"} in tasks.json.`
    );
  }
}

class TaskItem extends vscode.TreeItem {
  constructor(task, key, running, icon, hidden, orphan = false, duplicate = false) {
    super(
      task.name,
      vscode.TreeItemCollapsibleState.None
    );

    this.task = task;
    this.key = key;
    this.running = running;

    this.hidden = hidden;
    this.orphan = orphan;
    this.duplicate = duplicate;
    const hiddenColor = hidden
      ? new vscode.ThemeColor("list.deemphasizedForeground")
      : undefined;
    this.contextValue = duplicate
      ? "explorerTaskDuplicate"
      : orphan
        ? "explorerTaskOrphanRunning"
        : hidden
          ? (running ? "explorerTaskHiddenRunning" : "explorerTaskHidden")
          : (running ? "explorerTaskRunning" : "explorerTask");

    if (duplicate) {
      this.description = "Duplicated";
    } else if (orphan) {
      this.description = "Running · no matching definition";
    } else if (hidden) {
      this.description = "Hidden";
    }
    if (duplicate) {
      this.resourceUri = vscode.Uri.parse(
        `explorer-task-duplicate:/${encodeURIComponent(key)}`
      );
    } else if (hidden) {
      this.resourceUri = vscode.Uri.parse(
        `explorer-task-hidden:/${encodeURIComponent(key)}`
      );
    }

    if (running) {
      this.iconPath = new vscode.ThemeIcon("sync~spin");
    } else if (icon) {
      this.iconPath = new vscode.ThemeIcon(
        icon.id,
        duplicate
          ? new vscode.ThemeColor("list.deemphasizedForeground")
          : hiddenColor || (icon.color ? new vscode.ThemeColor(icon.color) : undefined)
      );
    } else {
      this.iconPath = new vscode.ThemeIcon(
        "gear",
        duplicate ? new vscode.ThemeColor("list.deemphasizedForeground") : hiddenColor
      );
    }

    if (!running && !duplicate) {
      this.command = {
        command: "explorerTasks.runTask",
        title: "Run Task",
        arguments: [this]
      };
    }

    this.tooltip = new vscode.MarkdownString();

    this.tooltip.appendMarkdown(
      `**${escapeMarkdown(task.name)}**\n\n`
    );

    if (task.detail) {
      this.tooltip.appendMarkdown(
        `${escapeMarkdown(task.detail)}\n\n`
      );
    }

    if (duplicate) {
      this.tooltip.appendMarkdown(
        `$(warning) Duplicate label — rename one of the tasks in tasks.json before running it`
      );
    } else if (orphan) {
      this.tooltip.appendMarkdown(
        `$(debug-stop) Running — the task definition changed or was removed; use the Stop action to terminate`
      );
    } else if (running) {
      this.tooltip.appendMarkdown(
        `$(debug-stop) Running — use the Stop action to terminate`
      );
    } else {
      this.tooltip.appendMarkdown(
        `$(play) Click to run`
      );
    }

    this.tooltip.supportThemeIcons = true;
  }
}

function activate(context) {
  const provider = new TasksProvider(context.workspaceState);

  const hiddenTaskDecorationProvider =
    vscode.window.registerFileDecorationProvider({
      provideFileDecoration(uri) {
        if (
          uri.scheme !== "explorer-task-hidden" &&
          uri.scheme !== "explorer-task-duplicate"
        ) return undefined;

        return {
          color: new vscode.ThemeColor("list.deemphasizedForeground")
        };
      }
    });

  const treeView = vscode.window.createTreeView(
    "explorerTasks.tasksView",
    { treeDataProvider: provider, showCollapseAll: false }
  );

  const clearTaskSelection = async item => {
    if (!treeView.selection.some(selected => selected.key === item.key)) return;
    // list.clear targets the last focused list, so explicitly target this view.
    try {
      await vscode.commands.executeCommand("explorerTasks.tasksView.focus");
      await vscode.commands.executeCommand("list.clear");
    } catch {
      // A UI-only command failure must not prevent task execution.
    }
  };

  const runCommand = vscode.commands.registerCommand(
    "explorerTasks.runTask",
    async item => {
      if (!item?.task) {
        return;
      }

      try {
        await clearTaskSelection(item);
        // Task events own running state, including tasks that finish quickly.
        await vscode.tasks.executeTask(item.task);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Could not run "${item.task.name}": ${
            error.message || error
          }`
        );
      }
    }
  );

  const stopCommand = vscode.commands.registerCommand(
    "explorerTasks.stopTask",
    async item => {
      if (!item) {
        return;
      }

      await clearTaskSelection(item);

      const execution =
        provider.getExecution(item);

      if (execution) {
        execution.terminate();
      }
    }
  );

  const refreshCommand = vscode.commands.registerCommand(
    "explorerTasks.refresh",
    () => {
      provider.refresh();
    }
  );

  const modifyTaskCommand = vscode.commands.registerCommand(
    "explorerTasks.modifyTask",
    item => openTaskDefinition(item?.task)
  );

  const openTaskConfigurationCommand = vscode.commands.registerCommand(
    "explorerTasks.openTaskConfiguration",
    async () => {
      await openOrCreateTaskConfiguration();
      provider.refresh();
    }
  );

  const addTaskCommand = vscode.commands.registerCommand(
    "explorerTasks.addTask",
    async () => {
      await addTask();
      provider.refresh();
    }
  );

  const addInputCommand = vscode.commands.registerCommand(
    "explorerTasks.addInput",
    addInput
  );

  const hideTaskCommand = vscode.commands.registerCommand(
    "explorerTasks.hideTask",
    item => setTaskHidden(item?.task, true)
  );

  const unhideTaskCommand = vscode.commands.registerCommand(
    "explorerTasks.unhideTask",
    item => setTaskHidden(item?.task, false)
  );

  const showHiddenTasksCommand = vscode.commands.registerCommand(
    "explorerTasks.showHiddenTasks",
    () => provider.setShowHidden(true)
  );

  const hideHiddenTasksCommand = vscode.commands.registerCommand(
    "explorerTasks.hideHiddenTasks",
    () => provider.setShowHidden(false)
  );

  const toggleGroupExpansionCommand = vscode.commands.registerCommand(
    "explorerTasks.toggleGroupExpansion",
    async () => {
      const configuration = vscode.workspace.getConfiguration("explorerTasks");
      const expanded = configuration.get("grouping.expanded", true);
      await configuration.update(
        "grouping.expanded",
        !expanded,
        vscode.ConfigurationTarget.Workspace
      );
    }
  );

  const toggleViewModeCommand = vscode.commands.registerCommand(
    "explorerTasks.toggleViewMode",
    async () => {
      const configuration = vscode.workspace.getConfiguration("explorerTasks");
      const mode = configuration.get("viewMode", "tree");
      await configuration.update(
        "viewMode",
        mode === "tree" ? "flat" : "tree",
        vscode.ConfigurationTarget.Workspace
      );
    }
  );

  const expandGroupsCommand = vscode.commands.registerCommand(
    "explorerTasks.expandGroups",
    () => vscode.workspace.getConfiguration("explorerTasks").update(
      "grouping.expanded",
      true,
      vscode.ConfigurationTarget.Workspace
    )
  );

  const collapseGroupsCommand = vscode.commands.registerCommand(
    "explorerTasks.collapseGroups",
    () => vscode.workspace.getConfiguration("explorerTasks").update(
      "grouping.expanded",
      false,
      vscode.ConfigurationTarget.Workspace
    )
  );

  const showFlatViewCommand = vscode.commands.registerCommand(
    "explorerTasks.showFlatView",
    () => vscode.workspace.getConfiguration("explorerTasks").update(
      "viewMode",
      "flat",
      vscode.ConfigurationTarget.Workspace
    )
  );

  const showTreeViewCommand = vscode.commands.registerCommand(
    "explorerTasks.showTreeView",
    () => vscode.workspace.getConfiguration("explorerTasks").update(
      "viewMode",
      "tree",
      vscode.ConfigurationTarget.Workspace
    )
  );

  const startListener =
    vscode.tasks.onDidStartTask(event => {
      provider.markRunning(event.execution);
    });

  const endListener =
    vscode.tasks.onDidEndTask(event => {
      provider.markStopped(event.execution);
    });

  const workspaceListener =
    vscode.workspace.onDidChangeWorkspaceFolders(
      () => provider.scheduleRefresh()
    );

  const configurationListener =
    vscode.workspace.onDidChangeConfiguration(event => {
      if (
        event.affectsConfiguration("tasks") ||
        event.affectsConfiguration("explorerTasks.grouping.expanded") ||
        event.affectsConfiguration("explorerTasks.viewMode")
      ) {
        provider.scheduleRefresh();
      }
    });

  const taskWatcher =
    vscode.workspace.createFileSystemWatcher(
      "**/.vscode/tasks.json"
    );

  taskWatcher.onDidCreate(
    () => provider.scheduleRefresh()
  );

  taskWatcher.onDidChange(
    () => provider.scheduleRefresh()
  );

  taskWatcher.onDidDelete(
    () => provider.scheduleRefresh()
  );

  context.subscriptions.push(
    provider,
    hiddenTaskDecorationProvider,
    treeView,
    runCommand,
    stopCommand,
    refreshCommand,
    modifyTaskCommand,
    openTaskConfigurationCommand,
    addTaskCommand,
    addInputCommand,
    hideTaskCommand,
    unhideTaskCommand,
    showHiddenTasksCommand,
    hideHiddenTasksCommand,
    toggleGroupExpansionCommand,
    toggleViewModeCommand,
    expandGroupsCommand,
    collapseGroupsCommand,
    showFlatViewCommand,
    showTreeViewCommand,
    startListener,
    endListener,
    workspaceListener,
    configurationListener,
    taskWatcher
  );
}

function deactivate() {}

async function addInput() {
  const choice = await vscode.window.showQuickPick([
    { label: "Prompt string", inputType: "promptString" },
    { label: "Pick string", inputType: "pickString" }
  ], { placeHolder: "Select an input type" });
  if (!choice) return;

  const uri = projectTaskConfigurationUri();
  if (!uri) {
    vscode.window.showErrorMessage("Open a folder or workspace before adding an input.");
    return;
  }

  try {
    let exists = true;
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      exists = false;
    }

    if (!exists && !vscode.workspace.workspaceFile && vscode.workspace.workspaceFolders?.[0]) {
      await vscode.workspace.fs.createDirectory(
        vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, ".vscode")
      );
    }

    const document = exists ? await vscode.workspace.openTextDocument(uri) : undefined;
    const text = document?.getText() || "";
    const errors = [];
    const root = text ? parseTaskConfiguration(text, errors) : undefined;
    if (errors.length > 0 || (root !== undefined && (!root || typeof root !== "object" || Array.isArray(root)))) {
      throw new Error("The task configuration contains invalid JSONC");
    }

    let path;
    let inputs;
    let createContainer = false;
    if (Array.isArray(root?.tasks)) {
      path = ["inputs"];
      inputs = Array.isArray(root.inputs) ? root.inputs : [];
    } else if (root?.tasks && typeof root.tasks === "object") {
      path = ["tasks", "inputs"];
      inputs = Array.isArray(root.tasks.inputs) ? root.tasks.inputs : [];
    } else if (root?.settings?.tasks && typeof root.settings.tasks === "object") {
      path = ["settings", "tasks", "inputs"];
      inputs = Array.isArray(root.settings.tasks.inputs) ? root.settings.tasks.inputs : [];
    } else {
      path = vscode.workspace.workspaceFile ? ["tasks"] : ["inputs"];
      inputs = [];
      createContainer = Boolean(vscode.workspace.workspaceFile);
    }

    const ids = new Set(inputs.map(input => input?.id));
    let id = "newInput";
    for (let suffix = 2; ids.has(id); suffix += 1) id = `newInput${suffix}`;

    const input = choice.inputType === "pickString"
      ? {
          id,
          type: "pickString",
          description: "Select a value",
          options: ["Option 1", "Option 2"],
          default: "Option 1"
        }
      : {
          id,
          type: "promptString",
          description: "Enter a value",
          default: ""
        };

    let updated;
    let inputPath;
    if (!exists) {
      updated = JSON.stringify({ version: "2.0.0", tasks: [], inputs: [input] }, null, 2) + "\n";
      inputPath = ["inputs", 0, "id"];
      const edit = new vscode.WorkspaceEdit();
      edit.createFile(uri);
      edit.insert(uri, new vscode.Position(0, 0), updated);
      if (!await vscode.workspace.applyEdit(edit)) {
        throw new Error("The task configuration could not be created");
      }
    } else {
      const targetPath = inputs.length > 0 ? [...path, inputs.length] : path;
      const value = inputs.length > 0
        ? input
        : createContainer
          ? { version: "2.0.0", tasks: [], inputs: [input] }
          : [input];
      updated = applyEdits(text, modify(text, targetPath, value, {
        formattingOptions: { insertSpaces: true, tabSize: 2 }
      }));
      inputPath = inputs.length > 0
        ? [...path, inputs.length, "id"]
        : createContainer
          ? ["tasks", "inputs", 0, "id"]
          : [...path, 0, "id"];
      const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, fullRange, updated);
      if (!await vscode.workspace.applyEdit(edit) || !await document.save()) {
        throw new Error("The task configuration could not be saved");
      }
    }

    const updatedDocument = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(updatedDocument);
    revealConfigurationPath(vscode, updatedDocument, editor, inputPath);
  } catch (error) {
    vscode.window.showErrorMessage(`Could not add an input: ${error.message || error}`);
  }
}

async function addTask() {
  const uri = projectTaskConfigurationUri();

  if (!uri) {
    vscode.window.showErrorMessage("Open a folder or workspace before adding a task.");
    return;
  }

  try {
    let exists = true;
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      exists = false;
    }

    if (!exists && !vscode.workspace.workspaceFile && vscode.workspace.workspaceFolders?.[0]) {
      await vscode.workspace.fs.createDirectory(
        vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, ".vscode")
      );
    }

    const document = exists
      ? await vscode.workspace.openTextDocument(uri)
      : undefined;
    const text = document?.getText() || "";
    const errors = [];
    const root = text ? parseTaskConfiguration(text, errors) : undefined;

    if (errors.length > 0 || (root !== undefined && (!root || typeof root !== "object" || Array.isArray(root)))) {
      throw new Error("The task configuration contains invalid JSONC");
    }

    let path;
    let definitions;
    let createContainer;
    if (Array.isArray(root?.tasks)) {
      path = ["tasks"];
      definitions = root.tasks;
    } else if (Array.isArray(root?.tasks?.tasks)) {
      path = ["tasks", "tasks"];
      definitions = root.tasks.tasks;
    } else if (Array.isArray(root?.settings?.tasks?.tasks)) {
      path = ["settings", "tasks", "tasks"];
      definitions = root.settings.tasks.tasks;
    } else {
      path = ["tasks"];
      definitions = [];
      createContainer = vscode.workspace.workspaceFile;
    }

    const labels = new Set(definitions.map(definition => definition?.label));
    let label = "New task";
    for (let suffix = 2; labels.has(label); suffix += 1) {
      label = `New task ${suffix}`;
    }

    const definition = {
      label,
      type: "shell",
      command: "echo",
      args: ["Edit this task in tasks.json"]
    };
    let updated;

    if (!exists) {
      updated = JSON.stringify({ version: "2.0.0", tasks: [definition] }, null, 2) + "\n";
      const edit = new vscode.WorkspaceEdit();
      edit.createFile(uri);
      edit.insert(uri, new vscode.Position(0, 0), updated);
      if (!await vscode.workspace.applyEdit(edit)) {
        throw new Error("The task configuration could not be created");
      }
    } else {
      const targetPath = definitions.length > 0
        ? [...path, definitions.length]
        : path;
      const value = definitions.length > 0
        ? definition
        : createContainer
          ? { version: "2.0.0", tasks: [definition] }
          : [definition];
      updated = applyEdits(text, modify(text, targetPath, value, {
        formattingOptions: { insertSpaces: true, tabSize: 2 }
      }));
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(text.length)
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, fullRange, updated);
      if (!await vscode.workspace.applyEdit(edit) || !await document.save()) {
        throw new Error("The task configuration could not be saved");
      }
    }

    const scope = vscode.workspace.workspaceFile
      ? vscode.TaskScope.Workspace
      : vscode.workspace.workspaceFolders?.[0];
    await openTaskDefinition({ name: label, definition: { type: "shell" }, scope });
  } catch (error) {
    vscode.window.showErrorMessage(
      `Could not add a task: ${error.message || error}`
    );
  }
}

async function openOrCreateTaskConfiguration() {
  const uri = projectTaskConfigurationUri();

  if (!uri) {
    vscode.window.showErrorMessage("Open a folder or workspace before creating tasks.json.");
    return;
  }

  try {
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      if (!vscode.workspace.workspaceFile && vscode.workspace.workspaceFolders?.[0]) {
        await vscode.workspace.fs.createDirectory(
          vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, ".vscode")
        );
      }
      const edit = new vscode.WorkspaceEdit();
      edit.createFile(uri);
      edit.insert(
        uri,
        new vscode.Position(0, 0),
        STARTER_TASK_CONFIGURATION
      );
      if (!await vscode.workspace.applyEdit(edit)) {
        throw new Error("The task configuration could not be created");
      }
    }

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Could not open or create the task configuration: ${error.message || error}`
    );
  }
}

async function openTaskDefinition(task) {
  if (!task) return;

  const uri = taskConfigurationUri(task);

  if (!uri) return;

  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    const text = document.getText();
    const match = findTaskDefinition(text, task);
    revealTaskDefinition(vscode, document, editor, match);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Could not open the task configuration: ${error.message || error}`
    );
  }
}

function taskConfigurationUri(task) {
  const folder = typeof task.scope === "object" ? task.scope : undefined;
  return folder ? vscode.Uri.joinPath(folder.uri, ".vscode", "tasks.json") : projectTaskConfigurationUri();
}

function projectTaskConfigurationUri() {
  return vscode.workspace.workspaceFile || (
        vscode.workspace.workspaceFolders?.[0]
          ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, ".vscode", "tasks.json")
          : undefined
      );
}

async function taskConfigurationExists() {
  const uri = projectTaskConfigurationUri();
  if (!uri) return false;

  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function setTaskHidden(task, hidden) {
  if (!task) return;
  const uri = taskConfigurationUri(task);
  if (!uri) return;

  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const text = document.getText();
    const match = findTaskDefinition(text, task);

    const edits = modify(
      text,
      [...match.path, "hide"],
      hidden ? true : undefined,
      { formattingOptions: { insertSpaces: true, tabSize: 2 } }
    );
    const updated = applyEdits(text, edits);
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(text.length)
    );
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(uri, fullRange, updated);
    if (!await vscode.workspace.applyEdit(workspaceEdit) || !await document.save()) {
      throw new Error("The task configuration could not be saved");
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Could not ${hidden ? "hide" : "unhide"} "${task.name}": ${error.message || error}`
    );
  }
}

function scopeOrder(task) {
  if (task.scope === vscode.TaskScope.Workspace) return -1;
  return (vscode.workspace.workspaceFolders || []).findIndex(
    folder => folder.uri.toString() === task.scope?.uri?.toString()
  );
}

function groupsExpandedByDefault() {
  const configuration = vscode.workspace.getConfiguration("explorerTasks");
  return configuration.get
    ? configuration.get("grouping.expanded", true)
    : true;
}

function viewMode() {
  const configuration = vscode.workspace.getConfiguration("explorerTasks");
  return configuration.get
    ? configuration.get("viewMode", "tree")
    : "tree";
}

function escapeMarkdown(value) {
  return String(value).replace(
    /([\\`*_{}[\]()#+\-.!])/g,
    "\\$1"
  );
}

module.exports = {
  activate,
  deactivate
};
