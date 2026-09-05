# Explorer Tasks

Explorer Tasks adds a Tasks view to the VS Code Explorer for running and stopping tasks defined in your project.

- Shows tasks explicitly defined in `.vscode/tasks.json`.
- Preserves the order of tasks in the configuration file.
- Groups tasks using ` / ` in their labels. 
- Provides Run/Stop controls and tracks tasks started elsewhere in VS Code.
- Shows an activity indicator while a task is running.

## Organize tasks into groups

Separate parts of a task label with ` / ` to create folders. For example:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Build / Development",
      "type": "shell",
      "command": "npm run build",
      "problemMatcher": []
    },
    {
      "label": "Build / Production",
      "type": "shell",
      "command": "npm run build:production",
      "problemMatcher": []
    },
    {
      "label": "Test",
      "type": "shell",
      "command": "npm test",
      "problemMatcher": []
    }
  ]
}
```

Groups appear where their first task occurs, and tasks within each group keep their JSON order. Keep related tasks together in the file for a matching visual order. Use the complete label when referencing a task in `dependsOn` or `preLaunchTask`.

> **Groups can be nested: `Build / Web / Production` creates two folder levels.**

Labels without ` / ` stay at the root. Ordinary slashes and colons are treated as part of the label.

## How it works

- Automatically detected tasks and user-level tasks are hidden. To show a task supplied by another extension, such as npm, explicitly configure it in your project.
- Changes to task configuration refresh the view automatically. You can also click **Refresh** in the view header or run **Explorer Tasks: Refresh** from the Command Palette.
- Use **Open tasks.json** from the view header or empty state to configure project tasks.
- If multiple instances of a task are running, Stop terminates one instance at a time.
- In multi-folder workspaces, workspace-level tasks come first, followed by folders in workspace order. Matching group paths share a group.
- Tasks use VS Code's existing terminals, inputs, and execution settings.

Set `explorerTasks.grouping.expanded` to `false` to make task groups start collapsed.
Toggle it with `Cmd+Alt+G` on macOS or `Ctrl+Alt+G` on Windows and Linux.
