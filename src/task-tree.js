// A spaced slash is reserved for grouping; ordinary paths and colons stay literal.
function buildTree(vscode, items, expanded = true) {
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

module.exports = { buildTree, hasGroupPath };
