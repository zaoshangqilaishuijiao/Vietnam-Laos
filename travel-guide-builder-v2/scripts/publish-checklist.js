#!/usr/bin/env node
/**
 * publish-checklist.js — 发布清单：--check 只读检查 / --execute 明确发布指令下的提交推送。
 * 每步只输出一行结论；任何一步失败即以非零码退出，不自动重试推送。
 *
 * 用法：
 *   只读检查：node publish-checklist.js <攻略目录> --repo=<发布仓库路径> [--remote=origin]
 *   执行发布：node publish-checklist.js <攻略目录> --repo=<发布仓库路径> --execute
 *
 * 检查内容：
 *   1. 校验新鲜度：静态结果及浏览器证据与当前 HTML/资源哈希一致
 *   2. 白名单推导：从输出 HTML 的实际相对引用递归推导必需文件（黑名单仅作兜底拦截）
 *   3. 敏感信息复扫：真实密钥形态（Google/百度/Supabase secret）
 *   4. git 暂存区与分支差异核对：禁止 trip-*.json / validation / before-* / baseline / research
 *   5. 邮箱门禁：hooksPath 与禁用域配置
 *   --execute 追加：白名单 git add → commit → push；Pages 部署由远端工作流异步完成
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { readOption } = require("./cli-options.js");
const { publicSourceViolations, DEPLOYMENT_FILES } = require("./public-config.js");
const { verifyGitIdentity } = require("./git-identity-gate.js");
const { assetDigest, browserValidationAcceptable } = require("./qa-evidence.js");
const { PUBLIC_PLACEHOLDERS, collectLocalAssetReferences } = require("./build-public-guide.js");

const FORBIDDEN_PUBLISH_PATTERNS = [
  { test: /(^|\/)trip-(request|brief|data)(\.before-[^/]+)?\.json$/i, reason: "过程 JSON 不得发布" },
  { test: /\.validation\.json$/i, reason: "验证报告不得发布" },
  { test: /(^|\/)[^/]*\.(before-[^/]*)?\.(html|json)$/i, reason: "旧基线/历史副本不得发布" },
  { test: /(^|\/)[^/]*\.baseline\.(html|json)$/i, reason: "基线副本不得发布" },
  { test: /(^|\/)research(\/|$)/i, reason: "研究目录不得发布" },
  { test: /(^|\/)\.DS_Store$/i, reason: "系统文件不得发布" },
  { test: /\.local\.json$/i, reason: "私有配置不得发布" }
];

const ALLOWED_EXTRA_BASENAMES = new Set(["build-public-guide.js"]);

function parseArgs(argv) {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  return {
    dir: path.resolve(positional[0] || "."),
    repo: readOption(argv, "repo") || path.resolve("."),
    remote: readOption(argv, "remote") || "origin",
    branch: readOption(argv, "branch") || "",
    page: readOption(argv, "page") || "",
    allowRemovedIds: (readOption(argv, "allow-removed-ids") || "").split(/,(?=(?:item|venue|booking|check|source|recommendation|image|link):)/).map(value => value.trim()).filter(Boolean),
    execute: argv.includes("--execute")
  };
}

function run(command, args, cwd, input) {
  return spawnSync(command, args, { cwd, encoding: "utf8", input, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
}

function fail(step, message) {
  console.error(`✗ ${step}：${message}`);
  process.exit(1);
}

/* 从单文件 HTML 的相对引用推导发布白名单；缺失或越界引用必须失败。 */
function deriveWhitelist(dir, entryHtml) {
  const whitelist = new Set([entryHtml]);
  const html = fs.readFileSync(path.join(dir, entryHtml), "utf8");
  for (const relative of collectLocalAssetReferences(html)) {
    const asset = path.join(dir, relative);
    if (!fs.existsSync(asset) || !fs.statSync(asset).isFile()) throw new Error(`HTML 引用的本地资源不存在：${relative}`);
    whitelist.add(relative);
  }
  return whitelist;
}

function discoverDeploymentExtras(repo, sourceHtml) {
  if (!sourceHtml.includes(PUBLIC_PLACEHOLDERS.buildSha)) {
    throw new Error(`待发布 HTML 缺少 ${PUBLIC_PLACEHOLDERS.buildSha}；请使用 render-guide.js --public-source 重新生成。`);
  }
  for (const relative of DEPLOYMENT_FILES) {
    if (!fs.existsSync(path.join(repo, relative))) throw new Error(`发布仓库缺少 ${relative}。`);
    if (fs.readFileSync(path.join(repo, relative), "utf8") !== fs.readFileSync(path.join(__dirname, "..", relative), "utf8")) throw new Error(`部署工具版本不一致：${relative}，请同步当前技能部署文件。`);
  }
  const workflowDir = path.join(repo, ".github", "workflows");
  const workflows = fs.existsSync(workflowDir)
    ? fs.readdirSync(workflowDir).filter((name) => /\.ya?ml$/i.test(name)).sort()
    : [];
  const workflow = workflows.find((name) => {
    const content = fs.readFileSync(path.join(workflowDir, name), "utf8");
    return content.includes("scripts/build-public-guide.js") && content.includes("actions/deploy-pages@");
  });
  if (!workflow) throw new Error("发布仓库缺少调用 build-public-guide.js 与 actions/deploy-pages 的 Pages workflow。");
  const workflowPath = `.github/workflows/${workflow}`;
  if (fs.readFileSync(path.join(repo, workflowPath), "utf8") !== fs.readFileSync(path.join(__dirname, "../assets/github-pages-deploy.yml"), "utf8")) throw new Error("请同步当前技能的 Pages workflow（main 分支、根目录 HTML）");
  return [...DEPLOYMENT_FILES, workflowPath];
}

function collectOutgoingCommits(git, remote, branch) {
  const remoteRef = `refs/remotes/${remote}/${branch}`;
  const hasRemoteRef = git("rev-parse", "--verify", "--quiet", remoteRef).status === 0;
  const result = hasRemoteRef
    ? git("rev-list", "HEAD", `^${remoteRef}`)
    : git("rev-list", "HEAD");
  if (result.status !== 0) throw new Error(result.stderr.trim() || "无法读取待推送提交历史");
  return result.stdout.split("\n").map((value) => value.trim()).filter(Boolean);
}

function findOutgoingOutsideWhitelist(git, commits, whitelist) {
  const hits = [];
  for (const commit of commits) {
    // Include deletions, root and merge commits; never split filenames on whitespace.
    const changed = git("diff-tree", "--root", "-m", "--no-commit-id", "--no-renames", "--name-only", "-z", "-r", commit);
    if (changed.status !== 0) throw Error("无法核对待推送提交的发布白名单");
    for (const file of new Set(changed.stdout.split("\0").filter(Boolean))) {
      if (!whitelist.has(file)) hits.push(`${commit.slice(0, 12)}:${file}`);
    }
  }
  return hits;
}

function findForbiddenOutgoingFiles(git, commits) {
  const hits = [];
  for (const commit of commits) {
    const changed = git("diff-tree", "--root", "-m", "--no-commit-id", "--name-only", "--diff-filter=ACMR", "-r", commit);
    if (changed.status !== 0) throw new Error(changed.stderr.trim() || `无法检查提交 ${commit}`);
    for (const file of changed.stdout.split("\n").filter(Boolean)) {
      const match = FORBIDDEN_PUBLISH_PATTERNS.find(({ test }) => test.test(file));
      if (match && !ALLOWED_EXTRA_BASENAMES.has(path.basename(file))) hits.push(`${commit.slice(0, 12)}:${file}（${match.reason}）`);
    }
  }
  return hits;
}

// Per invocation cache, keyed by Git object identity. Only incoming-to-remote blobs are read.
function scanOutgoingContents(git, commits, cache = new Map()) {
  const hits = [];
  for (const commit of commits) {
    const result = git("diff-tree", "--root", "-m", "--no-commit-id", "--raw", "--no-abbrev", "--no-renames", "-z", "--diff-filter=ACMT", "-r", commit);
    if (result.status !== 0) throw Error("无法读取待推送内容");
    const fields = result.stdout.split("\0");
    for (let i = 0; i < fields.length - 1; i += 2) {
      const match = fields[i].match(/^:\d+ (\d+) [a-f0-9]+ ([a-f0-9]+) [A-Z]\d*$/);
      if (!match) throw Error("待推送 Git 对象格式异常");
      const [,mode,oid] = match, file = fields[i+1];
      if (mode === "160000" || /\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf|mp[34]|pdf|zip)$/i.test(file)) continue;
      if (!cache.has(oid)) {
        const blob = git("cat-file", "blob", oid);
        if (blob.status !== 0) throw Error("无法扫描待推送文件内容");
        cache.set(oid, blob.stdout.includes("\0") ? [] : publicSourceViolations(blob.stdout));
      }
      for (const reason of cache.get(oid)) hits.push(`${commit.slice(0,12)}:${file}（${reason}）`);
    }
  }
  return [...new Set(hits)];
}

function checkOtherPages(dir, selected, whitelist, git, execute) {
  const tracked = git("ls-tree", "--name-only", "-z", "HEAD");
  if (tracked.status !== 0 && git("rev-parse", "--verify", "HEAD").status === 0) throw Error("无法读取已提交页面");
  const pages = new Set([...fs.readdirSync(dir), ...(tracked.stdout || "").split("\0")].filter(name => /\.html?$/i.test(name) && name !== selected));
  for (const page of pages) {
    const before = git("show", `HEAD:${page}`);
    const file=path.join(dir,page), exists=fs.existsSync(file);
    if (before.status !== 0 || !exists || fs.readFileSync(file,"utf8") !== before.stdout) console.log(`⚠ ${page} 有未提交变更或为新页面，本次不提交该页面。`);
    if (before.status !== 0) continue;
    // A selected shared asset changes the deployed version of the other page too.
    const sharedChanged = [...collectLocalAssetReferences(before.stdout)].filter(asset => whitelist.has(asset)).some(asset => {
      const previous=git("rev-parse", `HEAD:${asset}`), current=git("hash-object", "--", asset);
      return previous.status !== 0 || current.status !== 0 || previous.stdout.trim() !== current.stdout.trim();
    });
    if (!sharedChanged) continue;
    if (!exists || fs.readFileSync(file,"utf8") !== before.stdout) throw Error(`${page} 与当前攻略共享被修改的资源，需先用已提交页面完成共享资源验收`);
    const reportPath=path.join(dir,page.replace(/\.html?$/i,"")+".validation.json");
    if (!fs.existsSync(reportPath)) throw Error(`${page} 受共享资源更新影响，需要验收报告`);
    const report=JSON.parse(fs.readFileSync(reportPath,"utf8"));
    const hash=crypto.createHash("sha256").update(before.stdout).digest("hex");
    if (!report.htmlValidation?.valid || report.htmlValidation.htmlSha256 !== hash || (execute && (!browserValidationAcceptable(report.browserValidation) || report.browserValidation.htmlSha256 !== hash || report.browserValidation.assetSha256 !== assetDigest(file)))) throw Error(`${page} 的共享资源验收失效`);
    console.log(`✓ ${page} 的已提交页面已验证共享资源更新`);
  }
}

/* 敏感信息复扫（对白名单文本文件） */
function scanSecrets(dir, whitelist) {
  const violations = [];
  for (const relative of whitelist) {
    if (!/\.(html?|js|css|json|ya?ml|svg)$/i.test(relative)) continue;
    for (const reason of publicSourceViolations(fs.readFileSync(path.join(dir, relative), "utf8"))) violations.push(`${relative}（${reason}）`);
  }
  return violations;
}

function guideIdFromHtml(html) {
  return html.match(/<body\b[^>]*\bdata-guide-id=["']([A-Za-z0-9_-]{8,80})["']/i)?.[1] || "";
}

function stableContentKeys(html) {
  const keys = new Set();
  const visible = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  for (const [attribute, prefix] of [["data-item-id", "item"], ["data-venue-id", "venue"], ["data-booking-id", "booking"], ["data-check", "check"]]) {
    for (const match of visible.matchAll(new RegExp(`\\b${attribute}="([^"]+)"`, "g"))) keys.add(`${prefix}:${match[1]}`);
  }
  for (const match of visible.matchAll(/\bid="(source-[^"]+)"/g)) keys.add(`source:${match[1]}`);
  for (const match of visible.matchAll(/\bid="(recommendation-[^"]+)"/g)) keys.add(`recommendation:${match[1]}`);
  for (const match of visible.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/g)) keys.add(`image:${match[1]}`);
  for (const match of visible.matchAll(/<a\b[^>]*\bhref="(https?:[^"#]+)"[^>]*>/g)) {
    const href = match[1];
    if (/^https?:\/\/(?:www\.)?(?:google\.[^/]+\/maps|maps\.google\.[^/]+|maps\.apple\.com\/|xiaohongshu\.com\/search_result)/i.test(href)) continue; // 模板生成的搜索/导航 URL 不是独立内容。
    keys.add(`link:${href}`);
  }
  return keys;
}

function assertContentContinuity(validation, currentHtml, previousHtml, allowRemovedIds = []) {
  const oldId = guideIdFromHtml(previousHtml);
  const newId = guideIdFromHtml(currentHtml);
  if (oldId && oldId !== newId) throw new Error("待发布页面的 guideId 与已发布页面不同；不能把另一份攻略覆盖到同一发布路径。");
  // An existing path without guideId is a legacy migration, not a first publication.
  const proof = validation.contentContinuity;
  if (proof?.status !== "enforced" || !proof.baselineDataSha256 || !proof.baselineHtmlSha256 || !proof.inputSha256 || !proof.allowPaths?.length) {
    throw new Error("更新已发布攻略必须提供上一版 trip-data.json 与已发布 HTML 基线，并用 --baseline、--allow-paths、--baseline-html 重渲；当前报告没有内容连续性证明。");
  }
  const previousHash = crypto.createHash("sha256").update(previousHtml).digest("hex");
  if (proof.baselineHtmlSha256 !== previousHash) throw new Error("内容基线 HTML 不是该发布路径的上一版已提交页面；请用上一版正式页面重渲，不能选其他预览或历史副本。");
  const contentHash = html => html.match(/<meta\s+name="guide-content-sha256"\s+content="([a-f0-9]{64})"\s*\/?\s*>/i)?.[1] || "";
  if (!proof.inputContentSha256 || contentHash(currentHtml) !== proof.inputContentSha256) throw new Error("新页面缺少与本次 JSON 一致的内容指纹；请用当前技能重新渲染。");
  const previousContentHash = contentHash(previousHtml);
  if (previousContentHash && proof.baselineContentSha256 !== previousContentHash) throw new Error("上一版 JSON 与正式页面的内容指纹不一致；所选数据基线不是最近一次发布使用的数据。");
  if (!proof.baselinePath || !fs.existsSync(proof.baselinePath) || crypto.createHash("sha256").update(fs.readFileSync(proof.baselinePath)).digest("hex") !== proof.baselineDataSha256) {
    throw new Error("用于内容对比的上一版 trip-data.json 已移动或变更；请恢复正式基线后重渲。");
  }
  if (!proof.inputPath || !fs.existsSync(proof.inputPath) || crypto.createHash("sha256").update(fs.readFileSync(proof.inputPath)).digest("hex") !== proof.inputSha256) {
    throw new Error("验收报告对应的 trip-data.json 已移动或变更；请用当前正式数据重新渲染并验收。");
  }
  const previousKeys = stableContentKeys(previousHtml);
  const currentKeys = stableContentKeys(currentHtml);
  const removed = [...previousKeys].filter(key => !currentKeys.has(key));
  const allowed = new Set(allowRemovedIds);
  const unexplained = removed.filter(key => !allowed.has(key));
  if (unexplained.length) throw new Error(`上一版内容在本版消失：${unexplained.slice(0, 20).join("、")}${unexplained.length > 20 ? ` 等 ${unexplained.length} 项` : ""}。确认属于本次修改后，逐项传 --allow-removed-ids=<上述ID>；不要使用整组通配。`);
  const unmatched = [...allowed].filter(key => !removed.includes(key));
  if (unmatched.length) throw new Error(`--allow-removed-ids 包含未实际消失的 ID：${unmatched.join("、")}`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const dir = options.dir;
  if (!fs.existsSync(dir)) fail("目录", `攻略目录不存在：${dir}`);
  const mode = options.execute ? "execute" : "check";
  console.log(`发布清单（${mode} 模式）`);

  /* 1. 校验新鲜度 */
  const pages = fs.readdirSync(dir).filter(name => /\.html?$/i.test(name));
  if (!options.page && pages.length !== 1) fail("发布对象", "多页面目录请用 --page=<文件名.html> 指定本次攻略，不按报告时间自动选择。");
  const selectedPage = options.page || pages[0];
  if (!selectedPage || path.basename(selectedPage) !== selectedPage || !pages.includes(selectedPage)) fail("发布对象", "--page 必须是现有根目录 HTML 文件名");
  const validationFile = selectedPage.replace(/\.html?$/i, "") + ".validation.json";
  if (!fs.existsSync(path.join(dir,validationFile))) fail("校验", `${selectedPage} 缺少验收报告`);
  const validationPath = path.join(dir, validationFile);
  const validation = JSON.parse(fs.readFileSync(validationPath, "utf8"));
  if (validation?.htmlValidation?.valid !== true) fail("校验", `${validationFile} 显示 htmlValidation.valid !== true，禁止发布`);
  const outputName = validation.output;
  if (outputName !== selectedPage) fail("发布对象", "验收报告与 --page 指定的页面不一致");
  console.log(`→ 本次发布：${outputName}`);
  if (!outputName || path.basename(outputName) !== outputName) fail("校验", "输出必须是仓库根目录 HTML 文件名");
  if (Object.values(validation.frozenModules?.modules || {}).some(v => v.status === "drifted-restored")) fail("冻结模块", "JSON 与还原的 HTML 尚未一致，禁止发布");
  if (!outputName || !fs.existsSync(path.join(dir, outputName))) fail("校验", `validation.json 声明的输出 ${outputName || "缺失"} 不存在于目录`);
  const browserValidation = validation?.browserValidation || { status: "pending" };
  const browserStatus = browserValidation.status || "pending";
  const htmlSha256 = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, outputName))).digest("hex");
  if (validation.htmlValidation.htmlSha256 !== htmlSha256) fail("静态验收", "静态结果与当前 HTML 哈希不一致，需重新渲染");
  const resourcesHash = assetDigest(path.join(dir, outputName));
  if (!browserValidationAcceptable(browserValidation)) {
    const message = `browserValidation.status=${browserStatus}；需要先运行 record-browser-qa.js 记录横向溢出、控制台、地图和交互验收`;
    if (options.execute) fail("浏览器验收", message);
    console.log(`⚠ 浏览器验收：${message}`);
  } else if (browserValidation.htmlSha256 !== htmlSha256 || browserValidation.assetSha256 !== resourcesHash) {
    const message = "浏览器验收记录的 htmlSha256 与当前输出不一致；HTML 已变更，必须重新验收";
    if (options.execute) fail("浏览器验收", message);
    console.log(`⚠ 浏览器验收：${message}`);
  } else console.log(`✓ 校验：${validationFile} 通过；浏览器验收与当前 HTML 哈希一致${browserStatus === "passed_with_limitations" ? "（地图仅验证降级可用，未验证真实底图）" : ""}`);

  /* 2. 白名单推导 + 范围核对 */
  let whitelist;
  try { whitelist = deriveWhitelist(dir, outputName); }
  catch (error) { fail("范围", error.message); }
  const violations = [];
  for (const relative of whitelist) {
    if (ALLOWED_EXTRA_BASENAMES.has(path.basename(relative))) continue;
    for (const { test, reason } of FORBIDDEN_PUBLISH_PATTERNS) {
      if (test.test(relative)) violations.push(`${relative}（${reason}）`);
    }
  }
  if (violations.length) fail("范围", `发布白名单含禁止项：\n  - ${violations.join("\n  - ")}\n  基线与历史副本应保留在本地被忽略目录，不进入发布流程。`);
  console.log(`✓ 范围：仅发布 ${whitelist.size} 个白名单文件（从 ${outputName} 引用推导）；其他本地文件不扫描、不发布`);

  /* 3. 敏感信息复扫 */
  const secretHits = scanSecrets(dir, whitelist);
  if (secretHits.length) fail("密钥", `白名单文件命中真实密钥形态：\n  - ${secretHits.join("\n  - ")}\n  公开源 HTML 只允许 CI 占位符。`);
  console.log(`✓ 密钥：${whitelist.size} 个文件复扫无真实密钥形态`);

  /* 4. git 暂存区与分支核对：暂存区必须是发布白名单的子集。 */
  const repo = path.resolve(options.repo);
  const git = (...args) => run("git", args, repo);
  const previousPage = git("show", `HEAD:${outputName}`);
  if (previousPage.status === 0) {
    try { assertContentContinuity(validation, fs.readFileSync(path.join(dir, outputName), "utf8"), previousPage.stdout, options.allowRemovedIds); }
    catch (error) { fail("内容连续性", error.message); }
  }
  const currentBranch = git("rev-parse", "--abbrev-ref", "HEAD").stdout.trim();
  if (!currentBranch || currentBranch === "HEAD") fail("git", "当前为 detached HEAD；请明确切换发布分支后再运行。");
  const branch = options.branch || currentBranch;
  if (branch !== currentBranch) fail("git", `--branch=${branch} 与当前分支 ${currentBranch} 不一致；提交发生在当前分支，禁止扫描一个分支却推送另一个分支。`);
  const guideRepoPrefix = path.relative(repo, dir).replaceAll(path.sep, "/");
  if (branch !== "main") fail("部署", "当前 Pages workflow 仅支持 main 分支");
  if (guideRepoPrefix !== "") fail("部署", "当前 Pages workflow 仅支持仓库根目录攻略");
  if (guideRepoPrefix.startsWith("..")) fail("git", "攻略目录必须位于发布仓库内，才能精确核对暂存范围。");
  const gitWhitelist = new Set([...whitelist].map((relative) => guideRepoPrefix ? `${guideRepoPrefix}/${relative}` : relative));
  let deploymentExtras;
  try { deploymentExtras = discoverDeploymentExtras(repo, fs.readFileSync(path.join(dir, outputName), "utf8")); }
  catch (error) { fail("部署", error.message); }
  deploymentExtras.forEach((relative) => gitWhitelist.add(relative));
  if (scanSecrets(repo, new Set(deploymentExtras)).length) fail("密钥", "部署工具或 workflow 含真实配置");
  try { checkOtherPages(dir, outputName, whitelist, git, options.execute); } catch(error) { fail("其他页面", error.message); }
  const staged = git("diff", "--cached", "--name-only");
  if (staged.status !== 0) fail("git", "无法读取暂存区（目标是否为 git 仓库？）");
  const stagedFiles = staged.stdout.split("\n").filter(Boolean);
  const stagedOutsideWhitelist = stagedFiles.filter((file) => !gitWhitelist.has(file));
  if (stagedOutsideWhitelist.length) fail("git", `暂存区包含白名单外文件：${stagedOutsideWhitelist.join("、")}。发布提交只能包含输出 HTML、实际引用资源、构建脚本和 Pages workflow；请先 git restore --staged <文件>`);
  const stagedViolations = stagedFiles.filter((file) => FORBIDDEN_PUBLISH_PATTERNS.some(({ test }) => test.test(file)) && !ALLOWED_EXTRA_BASENAMES.has(path.basename(file)));
  if (stagedViolations.length) fail("git", `暂存区含禁止文件：${stagedViolations.join("、")}。请先 git restore --staged <文件>`);
  if (options.execute) {
    const fetched=git("fetch", "--no-tags", "--prune", options.remote);
    if(fetched.status!==0) fail("远端基线", "无法刷新远端提交范围，尚未提交或推送");
  }
  const historyContentCache = new Map();
  let outgoingCommits;
  let outgoingViolations;
  try {
    outgoingCommits = collectOutgoingCommits(git, options.remote, branch);
    const outside = findOutgoingOutsideWhitelist(git, outgoingCommits, gitWhitelist);
    if (outside.length) throw Error(`待推送提交包含发布白名单外文件：${outside.join("、")}；请明确整理本地发布范围，工具不会自动改写历史`);
    outgoingViolations = [...findForbiddenOutgoingFiles(git, outgoingCommits), ...scanOutgoingContents(git, outgoingCommits, historyContentCache)];
    for (const commit of outgoingCommits) {
      const changed=git("diff-tree","--root","-m","--no-commit-id","--name-only","-z","-r",commit);
      if(changed.status!==0) throw Error("无法核对待推送页面范围");
      const others=changed.stdout.split("\0").filter(file => /^[^/]+\.html?$/i.test(file) && file!==outputName);
      if(others.length) throw Error(`待推送提交还包含其他页面 ${others.join("、")}；--page 不会拆分已有提交，请先明确整理发布范围`);
    }
  } catch (error) { fail("git", error.message); }
  if (outgoingViolations.length) fail("git", `当前分支待推送历史含禁止文件：\n  - ${outgoingViolations.join("\n  - ")}\n  即使后续提交已删除，文件仍存在于公开历史；请先清理本地待推送提交。`);
  console.log(`✓ git：暂存区 ${stagedFiles.length} 个文件为发布白名单子集；待推送 ${outgoingCommits.length} 个提交无禁止文件（部署附加文件 ${deploymentExtras.length} 个）`);

  /* 5. 邮箱门禁 */
  const hooksPath = git("config", "--local", "core.hooksPath");
  if (hooksPath.status !== 0 || hooksPath.stdout.trim() !== ".githooks") fail("门禁", `发布仓库 core.hooksPath 未指向 .githooks（当前：${hooksPath.stdout.trim() || "未配置"}）。执行：git -C <仓库> config --local core.hooksPath .githooks`);
  const domains = git("config", "--local", "--get-all", "travelGuide.forbiddenEmailDomain");
  if (domains.status !== 0 || !domains.stdout.trim()) fail("门禁", "发布仓库未配置 travelGuide.forbiddenEmailDomain。执行：git -C <仓库> config --local --add travelGuide.forbiddenEmailDomain <禁用域>");
  try { verifyGitIdentity(git, outgoingCommits); }
  catch (error) { fail("身份门禁", error.message); }
  console.log("✓ 门禁：实际作者、提交者及全部待推送历史身份通过");

  if (!options.execute) {
    console.log(`→ 只读检查完成。若当前任务已明确要求发布，直接加 --execute 执行（无需再次向用户确认；执行模式会重跑全部门禁）。`);
    return;
  }

  /* --execute：浏览器验收已在上方硬拦截；只暂存白名单与首次发布所需部署文件。 */
  const beforeCommit = git("rev-parse", "HEAD").stdout.trim();
  const add = git("add", "--", ...[...gitWhitelist]);
  if (add.status !== 0) fail("add", add.stderr || "git add 失败");
  const stagedDiff = git("diff", "--cached", "--quiet");
  if (stagedDiff.status === 1) {
    const commit = git("commit", "-m", `publish: ${outputName} (${new Date().toISOString().slice(0, 10)})`);
    if (commit.status !== 0) fail("commit", commit.stderr || "git commit 失败");
  } else if (stagedDiff.status !== 0) fail("git", stagedDiff.stderr || "无法核对暂存区是否有新变更");
  const afterCommit = git("rev-parse", "HEAD").stdout.trim();
  if (!afterCommit) fail("git", "提交后无法读取 HEAD");
  if (afterCommit !== beforeCommit) {
    if (git("rev-parse", "HEAD^").stdout.trim() !== beforeCommit) fail("git", "提交过程改变了原有历史，停止推送并人工检查");
    let newCommitViolations;
    try {
      const changed = git("diff-tree", "--no-commit-id", "--name-only", "-z", "-r", afterCommit);
      if (changed.status !== 0) throw Error("无法核对新提交的文件范围");
      const outsideWhitelist = changed.stdout.split("\0").filter(file => file && !gitWhitelist.has(file));
      if (outsideWhitelist.length) throw Error(`新提交包含发布白名单外文件：${outsideWhitelist.join("、")}`);
      newCommitViolations = [...findForbiddenOutgoingFiles(git, [afterCommit]), ...scanOutgoingContents(git, [afterCommit], historyContentCache)];
    }
    catch (error) { fail("git", error.message); }
    if (newCommitViolations.length) fail("git", `新提交含禁止文件：\n  - ${newCommitViolations.join("\n  - ")}`);
  }
  try { verifyGitIdentity(git, afterCommit !== beforeCommit ? [afterCommit] : []); } catch (error) { fail("身份门禁", error.message); }
  const push = git("push", options.remote, branch);
  if (push.status !== 0) fail("push", push.stderr || "git push 失败");
  console.log(`✓ 发布：已推送 ${afterCommit.slice(0, 12)} 到 ${options.remote}/${branch}；Pages 工作流将异步部署，不在本地等待或核验线上状态。`);
}

if (require.main === module) main().catch(error => fail("发布", error.message));

module.exports = { FORBIDDEN_PUBLISH_PATTERNS, parseArgs, deriveWhitelist, discoverDeploymentExtras, collectOutgoingCommits, findOutgoingOutsideWhitelist, findForbiddenOutgoingFiles, scanSecrets, scanOutgoingContents, checkOtherPages, assertContentContinuity, stableContentKeys };
