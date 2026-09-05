const vscode = require("vscode");

class TasksProvider {
  constructor() {
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
        .map(task => ({ task, index: projectTaskIndex(task) }))
        .filter(entry => entry.index >= 0)
        .sort((a, b) => scopeOrder(a.task) - scopeOrder(b.task) || a.index - b.index);

      const hasTaskGroups = ordered.some(({ task }) => hasGroupPath(task.name));
      const mode = viewMode();
      const groupsExpanded = groupsExpandedByDefault();
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

      const items = ordered.map(({ task }) => {
        const key = taskKey(task);
        const executions = new Set(this.runningTasks.get(key) || []);
        for (const execution of vscode.tasks.taskExecutions) {
          if (taskKey(execution.task) === key) {
            executions.add(execution);
          }
        }
        return new TaskItem(task, key, executions.size > 0);
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
}

class TaskItem extends vscode.TreeItem {
  constructor(task, key, running) {
    super(
      task.name,
      vscode.TreeItemCollapsibleState.None
    );

    this.task = task;
    this.key = key;
    this.running = running;

    this.contextValue = running
      ? "explorerTaskRunning"
      : "explorerTask";

    if (running) {
      this.iconPath = new vscode.ThemeIcon("sync~spin");
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
  const provider = new TasksProvider();

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
    treeView,
    runCommand,
    stopCommand,
    refreshCommand,
    modifyTaskCommand,
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

  const folder = typeof task.scope === "object" ? task.scope : undefined;
  const uri = folder
    ? vscode.Uri.joinPath(folder.uri, ".vscode", "tasks.json")
    : vscode.workspace.workspaceFile || (
        vscode.workspace.workspaceFolders?.[0]
          ? vscode.Uri.joinPath(
              vscode.workspace.workspaceFolders[0].uri,
              ".vscode",
              "tasks.json"
            )
          : undefined
      );

  if (!uri) return;

  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    const text = document.getText();
    const label = JSON.stringify(task.name);
    const offset = text.indexOf(label);

    if (offset >= 0) {
      const start = document.positionAt(offset);
      const end = document.positionAt(offset + label.length);
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

function projectTaskIndex(task) {
  if (task.scope === vscode.TaskScope.Global || !task.scope) {
    return -1;
  }

  const folder = typeof task.scope === "object" ? task.scope : undefined;
  const configuration = vscode.workspace
    .getConfiguration("tasks", folder?.uri)
    .inspect("tasks");
  const definitions = folder
    ? configuration?.workspaceFolderValue ?? configuration?.workspaceValue
    : configuration?.workspaceValue;

  return Array.isArray(definitions) ? definitions.findIndex(definition => {
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
