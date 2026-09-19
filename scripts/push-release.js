const { execFileSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const { version } = require(path.join(projectRoot, "package.json"));
const tag = `v${version}`;

function git(args) {
  return execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (git(["status", "--porcelain"])) {
  fail("The working tree is not clean. Commit or discard the remaining changes before pushing a release.");
}

let taggedCommit;
try {
  taggedCommit = git(["rev-parse", `${tag}^{}`]);
} catch {
  fail(
    `Release tag ${tag} does not exist. Create it with:\n` +
    `git tag --annotate ${tag} --message "${version}" HEAD`
  );
}

const head = git(["rev-parse", "HEAD"]);
if (taggedCommit !== head) {
  fail(
    `Release tag ${tag} does not point to HEAD. This usually happens after amending the version commit.\n` +
    `Move it with:\n` +
    `git tag --force --annotate ${tag} --message "${version}" HEAD`
  );
}

if (process.argv.includes("--check")) {
  process.stdout.write(`${tag} points to HEAD.\n`);
  process.exit(0);
}

try {
  execFileSync(
    "git",
    ["push", "--atomic", "--set-upstream", "origin", "HEAD", `refs/tags/${tag}`],
    { cwd: projectRoot, stdio: "inherit" }
  );
} catch {
  process.exit(1);
}
