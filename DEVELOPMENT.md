# Development and release

## Build

Use Node.js 22 or newer and npm. From the repository root:

```sh
npm ci
npm run package
```

Packaging runs syntax checks and the regression suite, then writes `dist/explorer-tasks.vsix`. There are no runtime npm dependencies. The package contains the manifest, extension code, README, and changelog; this developer guide is excluded.

## Local installation

Run **Extensions: Install from VSIX…** and select `dist/explorer-tasks.vsix`, then run **Developer: Reload Window** after replacing an installed version.

The repository supplies **Project / Package extension**, **Project / Update local extension**, and **Project / Run regression tests** tasks. The update task builds and force-installs the VSIX. On macOS it uses the launcher under `/Applications/Visual Studio Code.app`; elsewhere it requires `code` on PATH.

## Validation

Press F5 in VS Code to launch an Extension Development Host. Automated tests mock the VS Code API. Check Run/Stop, concurrent instances, selection clearing, group expansion, configuration refresh, and multi-folder task ordering in a live host before publishing.

## Marketplace release

The README is written for Marketplace users. The package has not been published. Before publication, replace the `local` publisher identity with the owner's registered publisher, supply repository metadata, and confirm licensing (currently `UNLICENSED`). Set the release version in both package manifests and update CHANGELOG.md before building the final VSIX.
