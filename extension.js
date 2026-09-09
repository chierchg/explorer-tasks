const vscode = require("vscode");
const {
  applyEdits,
  findNodeAtLocation,
  modify,
  parse,
  parseTree
} = require("jsonc-parser");

class TasksProvider {
  constructor(workspaceState) {
    this.workspaceState = workspaceState;
    this.showHidden = workspaceState.get("showHiddenTasks", false);
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    this.runningTasks = new Map();

    // Pick up tasks that were already running before
    // this view/extension was activated.
    for (const execution of vscode.tasks.taskExecutions) {
      this.markRunning(execution);
    }
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  dispose() {
    this._onDidChangeTreeData.dispose();
    this.runningTasks.clear();
  }

  async getChildren(element) {
    if (element) {
      return element.children || [];
    }

    try {
      const tasks = await vscode.tasks.fetchTasks();

      const ordered = tasks
        .map(task => ({ task, ...projectTaskMatch(task) }))
        .filter(entry => entry.index >= 0)
        .sort((a, b) => scopeOrder(a.task) - scopeOrder(b.task) || a.index - b.index);

      const hasHiddenTasks = ordered.some(({ definition }) => definition?.hide === true);
      const displayed = this.showHidden
        ? ordered
        : ordered.filter(({ task, definition }) =>
            definition?.hide !== true || this.getExecutions(task).size > 0
          );

      const hasTaskGroups = displayed.some(({ task }) => hasGroupPath(task.name));
      const mode = viewMode();
      const groupsExpanded = groupsExpandedByDefault();
      await vscode.commands.executeCommand(
        "setContext",
        "explorerTasks.hasHiddenTasks",
        hasHiddenTasks
      );
      await vscode.commands.executeCommand(
        "setContext",
        "explorerTasks.showHiddenTasks",
        this.showHidden
      );
      await vscode.commands.executeCommand(
        "setContext",
        "explorerTasks.hasTaskGroups",
        hasTaskGroups
      );
      await vscode.commands.executeCommand(
        "setContext",
        "explorerTasks.treeViewMode",
        mode === "tree"
      );
      await vscode.commands.executeCommand(
        "setContext",
        "explorerTasks.groupsExpanded",
        groupsExpanded
      );

      const items = displayed.map(({ task, definition }) => {
        const key = taskKey(task);
        const executions = this.getExecutions(task);
        return new TaskItem(
          task,
          key,
          executions.size > 0,
          configuredTaskIcon(definition),
          definition?.hide === true
        );
      });

      return mode === "flat"
        ? items
        : buildTree(items, groupsExpanded);
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

    this.refresh();
  }

  markStopped(execution) {
    const key = taskKey(execution.task);
    const executions = this.runningTasks.get(key);

    if (executions) {
      executions.delete(execution);

      if (executions.size === 0) {
        this.runningTasks.delete(key);
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

  getExecutions(task) {
    const key = taskKey(task);
    const executions = new Set(this.runningTasks.get(key) || []);

    for (const execution of vscode.tasks.taskExecutions) {
      if (taskKey(execution.task) === key) executions.add(execution);
    }

    return executions;
  }

  async setShowHidden(value) {
    this.showHidden = value;
    await this.workspaceState.update("showHiddenTasks", value);
    this.refresh();
  }
}

class TaskItem extends vscode.TreeItem {
  constructor(task, key, running, icon, hidden) {
    super(
      task.name,
      vscode.TreeItemCollapsibleState.None
    );

    this.task = task;
    this.key = key;
    this.running = running;

    this.hidden = hidden;
    const hiddenColor = hidden
      ? new vscode.ThemeColor("list.deemphasizedForeground")
      : undefined;
    this.contextValue = hidden
      ? (running ? "explorerTaskHiddenRunning" : "explorerTaskHidden")
      : (running ? "explorerTaskRunning" : "explorerTask");

    if (hidden) this.description = "Hidden";
    if (hidden) {
      this.resourceUri = vscode.Uri.parse(
        `explorer-task-hidden:/${encodeURIComponent(key)}`
      );
    }

    if (running) {
      this.iconPath = new vscode.ThemeIcon("sync~spin");
    } else if (icon) {
      this.iconPath = new vscode.ThemeIcon(
        icon.id,
        hiddenColor || (icon.color ? new vscode.ThemeColor(icon.color) : undefined)
      );
    } else {
      this.iconPath = new vscode.ThemeIcon("gear", hiddenColor);
    }

    if (!running) {
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

    if (running) {
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
        if (uri.scheme !== "explorer-task-hidden") return undefined;

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
      () => provider.refresh()
    );

  const configurationListener =
    vscode.workspace.onDidChangeConfiguration(event => {
      if (
        event.affectsConfiguration("tasks") ||
        event.affectsConfiguration("explorerTasks.grouping.expanded") ||
        event.affectsConfiguration("explorerTasks.viewMode")
      ) {
        provider.refresh();
      }
    });

  const taskWatcher =
    vscode.workspace.createFileSystemWatcher(
      "**/.vscode/tasks.json"
    );

  taskWatcher.onDidCreate(
    () => provider.refresh()
  );

  taskWatcher.onDidChange(
    () => provider.refresh()
  );

  taskWatcher.onDidDelete(
    () => provider.refresh()
  );

  context.subscriptions.push(
    provider,
    hiddenTaskDecorationProvider,
    treeView,
    runCommand,
    stopCommand,
    refreshCommand,
    modifyTaskCommand,
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

async function openTaskDefinition(task) {
  if (!task) return;

  const uri = taskConfigurationUri(task);

  if (!uri) return;

  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    const text = document.getText();
    const match = findTaskDefinition(text, task);
    const labelNode = findNodeAtLocation(
      match.tree,
      [...match.path, "label"]
    );

    if (labelNode) {
      const start = document.positionAt(labelNode.offset);
      const end = document.positionAt(labelNode.offset + labelNode.length);
      const range = new vscode.Range(start, end);
      editor.selection = new vscode.Selection(start, start);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Could not open the task configuration: ${error.message || error}`
    );
  }
}

function taskConfigurationUri(task) {
  const folder = typeof task.scope === "object" ? task.scope : undefined;
  return folder
    ? vscode.Uri.joinPath(folder.uri, ".vscode", "tasks.json")
    : vscode.workspace.workspaceFile || (
        vscode.workspace.workspaceFolders?.[0]
          ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, ".vscode", "tasks.json")
          : undefined
      );
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

function findTaskDefinition(text, task) {
  const errors = [];
  const tree = parseTree(text, errors);
  const root = parse(text);

  if (!tree || errors.length > 0) {
    throw new Error("The task configuration contains invalid JSONC");
  }

  const candidates = [
    { path: ["tasks"], tasks: root?.tasks },
    { path: ["tasks", "tasks"], tasks: root?.tasks?.tasks },
    { path: ["settings", "tasks", "tasks"], tasks: root?.settings?.tasks?.tasks }
  ];
  const matches = [];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate.tasks)) continue;

    candidate.tasks.forEach((definition, index) => {
      if (definition?.label !== task.name) return;
      if (definition.type && definition.type !== task.definition?.type) return;
      matches.push({ tree, path: [...candidate.path, index] });
    });
  }

  if (matches.length === 0) {
    throw new Error(`Definition for "${task.name}" was not found`);
  }

  if (matches.length > 1) {
    throw new Error(`Multiple definitions match "${task.name}"`);
  }

  return matches[0];
}

function scopeOrder(task) {
  if (task.scope === vscode.TaskScope.Workspace) return -1;
  return (vscode.workspace.workspaceFolders || []).findIndex(
    folder => folder.uri.toString() === task.scope?.uri?.toString()
  );
}

// A spaced slash is reserved for grouping; ordinary paths and colons stay literal.
function buildTree(items, expanded = true) {
  const roots = [];
  for (const item of items) {
    const parts = item.task.name.split(" / ").map(part => part.trim());
    if (parts.some(part => !part)) {
      roots.push(item);
      continue;
    }
    let children = roots;
    const path = [];
    for (const part of parts.slice(0, -1)) {
      path.push(part);
      let group = children.find(child => child.children && child.label === part);
      if (!group) {
        group = new vscode.TreeItem(
          part,
          expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed
        );
        group.id = `group:${expanded}:` + JSON.stringify(path);
        group.contextValue = "explorerTaskGroup";
        group.iconPath = new vscode.ThemeIcon("folder");
        group.children = [];
        children.push(group);
      }
      children = group.children;
    }
    item.label = parts[parts.length - 1];
    children.push(item);
  }
  return roots;
}

function hasGroupPath(name) {
  const parts = name.split(" / ").map(part => part.trim());
  return parts.length > 1 && parts.every(Boolean);
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

function projectTaskMatch(task) {
  if (task.scope === vscode.TaskScope.Global || !task.scope) {
    return { index: -1, definition: undefined };
  }

  const folder = typeof task.scope === "object" ? task.scope : undefined;
  const configuration = vscode.workspace
    .getConfiguration("tasks", folder?.uri)
    .inspect("tasks");
  const definitions = folder
    ? configuration?.workspaceFolderValue ?? configuration?.workspaceValue
    : configuration?.workspaceValue;

  const index = Array.isArray(definitions) ? definitions.findIndex(definition => {
    if (!definition || typeof definition !== "object") return false;
    if (definition.type && definition.type !== task.definition.type) return false;
    if (definition.label) return definition.label === task.name;

    // Provider tasks can be explicitly configured without a label.
    const identityKeys = Object.keys(task.definition).filter(
      key => key !== "type" && key !== "_key"
    );
    const configuredKeys = identityKeys.filter(key => key in definition);
    return definition.type === task.definition.type && configuredKeys.length > 0 &&
      configuredKeys.every(key =>
        stableStringify(definition[key]) === stableStringify(task.definition[key])
      );
  }) : -1;

  return {
    index,
    definition: index >= 0 ? definitions[index] : undefined
  };
}

function configuredTaskIcon(definition) {
  const icon = definition?.icon;
  if (!icon || typeof icon !== "object") return undefined;
  if (typeof icon.id !== "string" || !icon.id.trim()) return undefined;

  return {
    id: icon.id.trim(),
    color: typeof icon.color === "string" && icon.color.trim()
      ? icon.color.trim()
      : undefined
  };
}

function taskKey(task) {
  let scope = "";

  if (
    task.scope &&
    typeof task.scope === "object" &&
    task.scope.uri
  ) {
    scope = task.scope.uri.toString();
  } else {
    scope = String(task.scope ?? "");
  }

  // A configured task label identifies the task within its workspace scope.
  // Provider metadata and definitions can be resolved differently per execution.
  return JSON.stringify([
    scope,
    task.name || ""
  ]);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return (
      "[" +
      value.map(stableStringify).join(",") +
      "]"
    );
  }

  const keys = Object.keys(value).sort();

  return (
    "{" +
    keys
      .map(
        key =>
          JSON.stringify(key) +
          ":" +
          stableStringify(value[key])
      )
      .join(",") +
    "}"
  );
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
