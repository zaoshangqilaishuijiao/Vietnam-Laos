#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "travel-guide-email-gate-"));
const hooks = path.join(temp, ".githooks");
fs.mkdirSync(hooks);
for (const name of ["email-gate.sh", "pre-commit", "pre-push"]) {
  const source = path.join(root, ".githooks", name);
  assert(fs.statSync(source).mode & 0o111, `.githooks/${name} 必须保持可执行权限`);
  fs.copyFileSync(source, path.join(hooks, name));
  fs.chmodSync(path.join(hooks, name), 0o755);
}

const run = (args, options = {}) => spawnSync(args[0], args.slice(1), {
  cwd: temp,
  encoding: "utf8",
  env: { ...process.env, ...(options.env || {}) },
  input: options.input
});
const git = (...args) => {
  const result = run(["git", ...args]);
  assert.equal(result.status, 0, `${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
};

git("init", "-q");
git("config", "user.name", "Public Tester");
git("config", "user.email", "tester@users.noreply.github.com");
git("config", "core.hooksPath", ".githooks");
git("config", "--add", "travelGuide.forbiddenEmailDomain", "corp.invalid");

let result = run([path.join(hooks, "pre-commit")]);
assert.equal(result.status, 0, "GitHub noreply 身份应通过 pre-commit");

result = run([path.join(hooks, "pre-commit")], {
  env: { GIT_AUTHOR_NAME: "Blocked", GIT_AUTHOR_EMAIL: "person@corp.invalid", GIT_COMMITTER_NAME: "Blocked", GIT_COMMITTER_EMAIL: "person@corp.invalid" }
});
assert.notEqual(result.status, 0, "环境变量覆盖的禁用作者/提交者应被 pre-commit 拦截");

git("commit", "--allow-empty", "-m", "allowed base");
const allowedBase = git("rev-parse", "HEAD");
result = run(["git", "commit", "--allow-empty", "--no-verify", "-m", "blocked history"], {
  env: { GIT_AUTHOR_NAME: "Blocked", GIT_AUTHOR_EMAIL: "person@sub.corp.invalid", GIT_COMMITTER_NAME: "Blocked", GIT_COMMITTER_EMAIL: "person@corp.invalid" }
});
assert.equal(result.status, 0, result.stderr);
const blockedCommit = git("rev-parse", "HEAD");
git("commit", "--allow-empty", "-m", "allowed head");
const allowedHead = git("rev-parse", "HEAD");

const pushLine = (remoteSha) => `refs/heads/main ${allowedHead} refs/heads/main ${remoteSha}\n`;
result = run([path.join(hooks, "pre-push"), "origin", "unused"], { input: pushLine(blockedCommit) });
assert.equal(result.status, 0, "已在远端基线中的旧提交不应被重复当作待推送提交");

result = run([path.join(hooks, "pre-push"), "origin", "unused"], { input: pushLine(allowedBase) });
assert.notEqual(result.status, 0, "本次待推送范围内的禁用邮箱提交应被 pre-push 拦截");

git("config", "--unset-all", "travelGuide.forbiddenEmailDomain");
result = run([path.join(hooks, "pre-commit")]);
assert.notEqual(result.status, 0, "未配置禁用域时应失败关闭，不得静默放行");

const committedHookText = ["email-gate.sh", "pre-commit", "pre-push"]
  .map((name) => fs.readFileSync(path.join(root, ".githooks", name), "utf8"))
  .join("\n");
assert(!/^FORBIDDEN_DOMAINS=/m.test(committedHookText), "可提交 hook 不得内置禁用邮箱域列表");
assert(committedHookText.includes("travelGuide.forbiddenEmailDomain"), "hook 必须从本仓库的本机 Git 配置读取禁用域");

console.log("PASS Git pre-commit/pre-push email gate, local domain config, and push-range checks");
