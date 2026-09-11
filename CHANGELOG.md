# Changelog

## 1.0.0

- Require task labels to be unique within each workspace scope, reporting and displaying duplicated labels as disabled warning rows.
- Add an empty-state action that opens or creates `tasks.json`.
- Add a one-click toolbar action that inserts a uniquely named shell task and opens it for editing.

## 0.5.3

- Add image to README to illustrate the extension's features.

## 0.5.2

- Locate task definitions structurally so Modify, Hide, and Unhide do not target comments, references, or a different task with the same label.
- Index task definitions once per workspace scope to avoid repeated configuration scans during view refreshes.
- Coalesce configuration and file event bursts, and share concurrent task-list loads.
- Snapshot running executions once per refresh and avoid resending unchanged view contexts.
- Keep renamed or removed running tasks visible and stoppable until their executions end.

## 0.5.1

- Tighten the README description.

## 0.5.0

- Respect `hide` in task definitions.
- Add UI controls for hiding, revealing, and unhiding tasks.
- Visually deemphasize revealed hidden tasks, and keep them visible while running.

## 0.4.0

- Add task icons with optional theme colors and a neutral default icon.

## 0.3.1

- Show view controls from their default state when the workspace has no `settings.json`.

## 0.3.0

- Replace the global task-configuration action with an inline action for each task.
- Make idle task rows run on click while requiring the explicit Stop action for running tasks.
- Remove the group-expansion keyboard shortcut in favor of UI controls.
- Add a workspace option for switching between flat and tree views when grouped labels exist.
- Make view-control icons reflect the action available for the current state.
- Show configured task details in task tooltips.

## 0.2.0

- Add an action and empty-state shortcut for opening task configuration.
- Show an animated indicator for running tasks.
- Add a setting to make task groups start collapsed.
- Add a command and keyboard shortcut for toggling group expansion.

## 0.1.1

- Add icon for the extension.

## 0.1.0

- Show explicitly configured project tasks in the native Explorer tree.
- Preserve JSON order and support nested groups through ` / ` in labels.
- Display folder icons for groups.
- Run and stop tasks using labels. 
- Clear selected task rows when invoking these actions.
- Track concurrent executions and tasks started elsewhere in VS Code.
- Refresh on project task configuration and workspace folder changes.
