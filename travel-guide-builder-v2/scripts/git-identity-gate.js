function verifyGitIdentity(git, commits = []) {
  const result = git("config", "--local", "--get-all", "travelGuide.forbiddenEmailDomain");
  const domains = (result.stdout || "").trim().toLowerCase().split(/\s+/).map(d => d.replace(/^[@.]/, "").replace(/\.$/, ""));
  if (result.status !== 0 || domains.some(d => !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(d))) throw Error("未配置有效的禁用邮箱域，停止公开提交/推送");
  const check = value => {
    const email = String(value || "").trim().toLowerCase();
    if (!/^[^\s@<>]+@[^\s@<>]+$/.test(email)) throw Error("实际 Git 身份为空或无效");
    const domain = email.split("@")[1];
    if (domains.some(d => domain === d || domain.endsWith("." + d))) throw Error("实际 Git 身份或待推送历史命中禁用域，停止操作");
  };
  for (const name of ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"]) {
    const r = git("var", name);
    if (r.status !== 0) throw Error("无法解析实际 Git 身份");
    check(r.stdout.match(/<([^<>]+)>/)?.[1]);
  }
  for (const commit of commits) {
    const r = git("show", "-s", "--format=%ae%n%ce", commit);
    if (r.status !== 0) throw Error("无法读取待推送历史身份");
    const values = r.stdout.trim().split("\n");
    if (values.length !== 2) throw Error("待推送历史身份不完整");
    values.forEach(check);
  }
  return true;
}
module.exports = { verifyGitIdentity };
