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

The README is written for Marketplace users. Create a publisher under your Microsoft account at the Marketplace publisher management page, then put its ID in the `publisher` field of `package.json`. The project currently has no public repository and retains `UNLICENSED`; packaging explicitly allows a missing repository and license file. No open-source license is assigned.

```sh
npm run package:marketplace
```

This checks that the placeholder publisher has been replaced, runs syntax checks and tests, and builds `dist/explorer-tasks-marketplace.vsix` with vsce validation. The command does not publish anything. The local package command remains available for development installs.

If you later add a repository or license, update the manifest, include the license file in `.vscodeignore`, and remove the corresponding packaging exception.

Upload the final VSIX through the [Marketplace publisher management page](https://marketplace.visualstudio.com/manage). Choose the registered publisher, then **New extension → Visual Studio Code**, and select the package. See Microsoft's [publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) for account setup and publication details.

Before publication, verify the VSIX in a live VS Code window, including task Run/Stop, groups, ordering, and selection clearing. Keep authentication credentials out of the repository. Update the version and changelog for subsequent releases.
