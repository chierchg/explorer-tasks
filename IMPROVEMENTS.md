# Possible Future Improvements

The main task-view hot paths have been optimized by indexing task definitions,
coalescing refreshes, sharing concurrent loads, snapshotting running executions,
and caching view contexts. The following lower-priority optimizations remain
possible if profiling shows that very large or deeply grouped workspaces need
additional work.

## Precompute workspace-folder order

Task sorting currently calls `scopeOrder` from the sort comparator. For folder
tasks, `scopeOrder` scans `vscode.workspace.workspaceFolders` to find the
folder's position. Sorting can therefore cost approximately
`O(tasks * log(tasks) * folders)` in a large multi-root workspace.

A future implementation could build a `Map` from folder URI to folder index
once per task-list refresh and use constant-time lookups from the comparator.
It must preserve the existing behavior:

- Workspace-scoped tasks appear before folder-scoped tasks.
- Workspace folders retain their declared order.
- Tasks within each scope retain their order from the task configuration.
- Unknown scopes are handled deterministically.

This is unlikely to be noticeable in ordinary workspaces with only a few
folders, so it should remain deferred until supported by profiling data.

## Index groups while building the tree

Tree construction currently searches each sibling list to find an existing
group. When many tasks introduce unique sibling groups, repeated linear searches
can make construction approach quadratic time.

A future implementation could maintain a temporary `Map` of child groups for
each level while building the tree. The maps should be discarded after the tree
is built and must not become part of the `TreeItem` objects returned to VS Code.
The implementation must preserve the existing behavior:

- A group appears where its first task occurs.
- Task and group ordering remains stable.
- Nested ` / ` groups behave exactly as they do now.
- Invalid or empty group segments remain ordinary task labels.
- Stable group IDs and expansion behavior remain unchanged.

This optimization is mainly relevant to unusually large task files with many
distinct groups. For typical task counts, the current implementation is simpler
and sufficiently fast.
