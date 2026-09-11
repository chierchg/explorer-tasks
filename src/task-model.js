function createProjectTaskMatcher(vscode) {
  const indexesByScope = new Map();

  return task => {
    if (task.scope === vscode.TaskScope.Global || !task.scope) {
      return { index: -1, definition: undefined };
    }

    const folder = typeof task.scope === "object" ? task.scope : undefined;
    const scopeKey = folder?.uri?.toString() || "workspace";
    let index = indexesByScope.get(scopeKey);

    if (!index) {
      const configuration = vscode.workspace
        .getConfiguration("tasks", folder?.uri)
        .inspect("tasks");
      const definitions = folder
        ? configuration?.workspaceFolderValue ?? configuration?.workspaceValue
        : configuration?.workspaceValue;
      index = indexTaskDefinitions(definitions);
      indexesByScope.set(scopeKey, index);
    }

    const labeled = index.byLabel.get(task.name) || [];
    const provider = index.unlabeledByType.get(task.definition.type) || [];
    const matches = [
      ...labeled.filter(({ definition }) =>
        !definition.type || definition.type === task.definition.type
      ),
      ...provider.filter(({ definition }) => providerDefinitionMatches(definition, task))
    ];
    const match = matches.reduce(
      (first, candidate) => !first || candidate.index < first.index ? candidate : first,
      undefined
    );

    return match
      ? { ...match, duplicateLabel: labeled.length > 1 }
      : { index: -1, definition: undefined, duplicateLabel: false };
  };
}

function indexTaskDefinitions(definitions) {
  const byLabel = new Map();
  const unlabeledByType = new Map();

  if (!Array.isArray(definitions)) return { byLabel, unlabeledByType };

  definitions.forEach((definition, index) => {
    if (!definition || typeof definition !== "object") return;
    const entry = { index, definition };
    const target = definition.label ? byLabel : unlabeledByType;
    const key = definition.label || definition.type;
    if (!key) return;
    const entries = target.get(key) || [];
    entries.push(entry);
    target.set(key, entries);
  });

  return { byLabel, unlabeledByType };
}

function providerDefinitionMatches(definition, task) {
  const identityKeys = Object.keys(task.definition).filter(
    key => key !== "type" && key !== "_key"
  );
  const configuredKeys = identityKeys.filter(key => key in definition);

  return configuredKeys.length > 0 && configuredKeys.every(key =>
    stableStringify(definition[key]) === stableStringify(task.definition[key])
  );
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
  const scope = task.scope && typeof task.scope === "object" && task.scope.uri
    ? task.scope.uri.toString()
    : String(task.scope ?? "");
  return JSON.stringify([scope, task.name || ""]);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";

  return "{" + Object.keys(value).sort().map(
    key => JSON.stringify(key) + ":" + stableStringify(value[key])
  ).join(",") + "}";
}

module.exports = {
  configuredTaskIcon,
  createProjectTaskMatcher,
  taskKey
};
