# Development and release

This document describes the development and release process for the extension.

## Build

From the repository root:

```sh
npm ci
npm run package
```

Packaging runs syntax checks and the regression suite, then writes `dist/explorer-tasks.vsix`. There are no runtime npm dependencies. 

> **The files included in the package are specified in `.vscodeignore`.**

## Development host

Press `F5` in the project window to launch an Extension Development Host. The
launch configuration opens `test-workspace`, which contains manual test tasks,
while loading the extension directly from this project. After editing the
extension, run **Developer: Reload Window** in the Development Host; reinstalling
the VSIX is not required.

## Before publishing

Before publication, verify the VSIX in a live VS Code window.

1. Run **Extensions: Install from VSIX…** and select `dist/explorer-tasks.vsix`.

2. Run **Developer: Reload Window** after replacing an installed version.

3. Check Run/Stop, concurrent instances, selection clearing, group expansion, configuration refresh, and multi-folder task ordering.

## Marketplace release

1. Update the version in `package.json` and `CHANGELOG.md` for the new release.

2. Run `npm run package` to build the VSIX.

3. Upload the VSIX through the [Marketplace publisher management page](https://marketplace.visualstudio.com/manage). 
