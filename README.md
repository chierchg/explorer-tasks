# Explorer Tasks

The **Explorer Tasks** extension allows you to view and run tasks directly from the Explorer tab. 

- Show tasks explicitly defined in `.vscode/tasks.json`.
- Preserve the order of tasks in the configuration file.
- Group tasks using ` / ` in their labels.
- Run and stop tasks with a single click.

## Controls

- Click an idle task to run it.
- Click the Stop action to terminate a running task.
- Click the pencil action to open its definition in `tasks.json`.
- Click Refresh to reload the task list manually. 
- Changes to `tasks.json` refresh the task list automatically.

## View options

- Grouping is enabled when at least one task label contains ` / `.
- Tasks can be displayed in a flat list or a tree view with groups.
- Groups can be set to start expanded or collapsed. 

## Organize tasks into groups

- Separate parts of a task label with ` / ` to create folders. 
- **Groups can be nested!**
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
      "command": "npm test",
      "problemMatcher": []
    },
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
    }
  ]
}
```

Groups appear where their first task occurs, and tasks within each group keep their JSON order. Keep related tasks together in the file for a matching visual order. 
