# Explorer Tasks

Run tasks directly from the Explorer tab. 

- Show tasks defined in `tasks.json` with order preserved.
- Run and stop tasks with a single click.
- Hide individual tasks or reveal hidden tasks.
- Group tasks using ` / ` in their labels.
- Customize task icons and colors.

## Task controls

- Click an idle task to run it.
- Click the Stop action to terminate a running task.
- Click the Edit action to open its definition in `tasks.json`.
- Click the Hide action to exclude a task from the view.
- Click the Unhide action to reveal a hidden task.
- If a running task is renamed or removed, its original label remains visible
  with a Stop action until that execution ends.

*Note:* Hide action adds `"hide": true` to the task definition in `tasks.json`. Unhide action removes it. In addition to the UI actions, you can manually add or remove this property to hide or unhide a task.

## Toolbar actions

- Reload the task list manually.
- Switch between Flat View and Tree View (only when groups exist).
- Expand or Collapse groups by default (only in Tree View).
- Show hidden tasks (only when hidden tasks exist).

*Note:* Flat/Tree and Expand/Collapse settings are saved per workspace in `.vscode/settings.json`.

## Organize tasks into groups

- Separate parts of a task label with ` / ` to create folders. Use multiple ` / ` to create nested folders.
- Groups appear where their first task occurs, and tasks within each group keep their JSON order.
- Labels without ` / ` stay at the root. 
- Use the complete label when referencing a task in `dependsOn` or `preLaunchTask`.
- Ordinary slashes and colons are treated as part of the label.

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Test",
      "type": "shell",
      "command": "npm test"
    },
    {
      "label": "Build / Development",
      "type": "shell",
      "command": "npm run build"
    },
    {
      "label": "Build / Production",
      "type": "shell",
      "command": "npm run build:production"
    }
  ]
}
```

## Task icons

- Tasks use a neutral gear icon by default. 
- Add an `icon` object to a task to use any valid [Codicon ID](https://microsoft.github.io/vscode-codicons/dist/codicon.html).
- Optionally set a [color](https://code.visualstudio.com/api/references/theme-color) for the icon.
- A running indicator temporarily replaces the configured icon while the task
is active.

```json
{
  "label": "Build",
  "type": "shell",
  "command": "npm run build",
  "icon": {
    "id": "package",
    "color": "charts.blue"
  }
}
```

Useful theme colors for task icons include:

```json
"color": "charts.blue"
"color": "charts.green"
"color": "charts.yellow"
"color": "charts.orange"
"color": "charts.red"
"color": "charts.purple"
"color": "charts.foreground"

"color": "terminal.ansiBlue"
"color": "terminal.ansiGreen"
"color": "terminal.ansiYellow"
"color": "terminal.ansiRed"
"color": "terminal.ansiMagenta"
"color": "terminal.ansiCyan"
"color": "terminal.ansiWhite"
```
