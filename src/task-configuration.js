const {
  findNodeAtLocation,
  parse,
  parseTree
} = require("jsonc-parser");

const JSONC_PARSE_OPTIONS = { allowTrailingComma: true };

const STARTER_TASK_CONFIGURATION = [
  "{",
  '  "version": "2.0.0",',
  '  "tasks": [',
  "    /* Example task:",
  "    {",
  '      "label": "Build",  // Display name must be unique within a workspace.',
  '      "type": "shell",   // Common task types include "shell" and "process".',
  '      "command": "npm",  // Program or shell command to execute.',
  '      "args": ["run", "build"],  // Arguments passed to the command.',
  '      "icon": {"id": "package"}  // Optional task icon.',
  "    }",
  "    */",
  "  ]",
  "}",
  ""
].join("\n");

function findTaskDefinition(text, task) {
  const errors = [];
  const tree = parseTree(text, errors, JSONC_PARSE_OPTIONS);
  const root = parseTaskConfiguration(text);

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

function parseTaskConfiguration(text, errors = []) {
  return parse(text, errors, JSONC_PARSE_OPTIONS);
}

function revealTaskDefinition(vscode, document, editor, match) {
  revealConfigurationNode(vscode, document, editor, match.tree, [...match.path, "label"]);
}

function revealConfigurationPath(vscode, document, editor, path) {
  const errors = [];
  const tree = parseTree(document.getText(), errors, JSONC_PARSE_OPTIONS);
  if (!tree || errors.length > 0) return;
  revealConfigurationNode(vscode, document, editor, tree, path);
}

function revealConfigurationNode(vscode, document, editor, tree, path) {
  const node = findNodeAtLocation(tree, path);
  if (!node) return;

  const start = document.positionAt(node.offset);
  const end = document.positionAt(node.offset + node.length);
  const range = new vscode.Range(start, end);
  editor.selection = new vscode.Selection(start, start);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

module.exports = {
  STARTER_TASK_CONFIGURATION,
  findTaskDefinition,
  parseTaskConfiguration,
  revealConfigurationPath,
  revealTaskDefinition
};
