# Explorer Tasks

Run tasks directly from the Explorer tab. 

- Show tasks explicitly defined in `.vscode/tasks.json`.
- Preserve the order of tasks in the configuration file.
- Run and stop tasks with a single click.
- Group tasks using ` / ` in their labels.
- Customize task icons and colors.

## Controls

- Click an idle task to run it.
- Click the Stop action to terminate a running task.
- Click the pencil action to open its definition in `tasks.json`.
- Click Refresh to reload the task list manually. 
- Changes to `tasks.json` refresh the task list automatically.

## View options

- Grouping is enabled when at least one task label contains ` / `.
- Tasks can be displayed in a flat list or a tree view with groups.
- Groups can start expanded or collapsed by default.

## Organize tasks into groups

- Separate parts of a task label with ` / ` to create folders. 
- Groups can be nested!
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

Groups appear where their first task occurs, and tasks within each group keep their JSON order. Keep related tasks together in the file for a matching visual order. 

## Task icons

Tasks use a neutral gear icon by default. Add an `icon` object to a task to use
any valid [Codicon ID](https://microsoft.github.io/vscode-codicons/dist/codicon.html) and, optionally, a [theme color](https://code.visualstudio.com/api/references/theme-color) for the icon.

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

The running indicator temporarily replaces the configured icon while the task
is active.

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