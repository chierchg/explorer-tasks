# Development and release

This document describes how to develop, test, and release the extension.

## Install dependencies

From the repository root:

```sh
npm ci
```

The extension uses `jsonc-parser` at runtime to preserve comments and formatting
when hide/unhide actions edit task definitions. Packaging must include this
dependency; verify it appears in the VSIX file list.

## Develop and test

Press `F5` to launch the Extension Development Host. It opens `test-workspace`, which contains tasks for manually exercising the extension while loading the extension code directly from this repository.

After changing JavaScript in `src/` or manifest contributions, close the Development Host **or** run **Developer: Reload Window** in the Development Host. Installing a VSIX is not required during development.

Run the automated checks with:

```sh
npm run check
npm test
```

Before completing a release, manually verify:

- Clicking an idle task runs it; stopping requires the inline Stop action.
- The Modify action opens the correct task definition without selecting text.
- Running state updates for tasks started inside and outside the extension.
- Task details appear in tooltips.
- Per-task hide/unhide and the conditional show-hidden control preserve JSONC formatting; revealed hidden tasks are visually deemphasized and running hidden tasks remain visible until their final execution stops.
- Nested ` / ` groups, expansion controls, and flat/tree switching work.
- View controls appear only when grouped tasks exist and show the correct icons.
- Editing `tasks.json` refreshes the view.
- Workspace and folder tasks retain their expected order in a multi-root workspace.

## Build the VSIX

Run either the **Build package** task or:

```sh
npm run package
```

Packaging runs the syntax check and regression suite before writing
`dist/explorer-tasks.vsix`. Package contents are controlled by `.vscodeignore`.

For the final smoke test, install that file with **Extensions: Install from
VSIX…**, reload VS Code, and repeat the critical manual checks.

## Prepare a release

1. Move the entries from **Unreleased** in `CHANGELOG.md` under the new version
   heading and commit all release changes. `npm version` requires a clean Git
   working tree.
2. Run **Regression tests** task.
3. Run **Increase version** task and select `patch`, `minor`, or `major`. This
   updates both `package.json` and `package-lock.json`, creates a version commit,
   and creates the corresponding `v<version>` Git tag.
4. Run **Build package** task to create the VSIX file for publication.

The version commit and tag are local until pushed, so they can be corrected before the release leaves the machine.

## Publish

1. Upload `dist/explorer-tasks.vsix` through the
   [Marketplace publisher management page](https://marketplace.visualstudio.com/manage).
2. Run **Push release** task to push the current branch and its annotated version
   tag to `origin`. The task also establishes the upstream for a new branch.

> [!NOTE]
> A normal `git push` does not push tags. If that happens, push the annotated local version tag with
>
> ```sh
> git push origin --follow-tags
> ```
