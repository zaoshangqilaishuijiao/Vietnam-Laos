#!/bin/sh
# 公开 Git 邮箱门禁共享逻辑。禁用域只存在本仓库的 Git 配置，不写入可提交文件。

email_gate_fail() {
  echo "" >&2
  echo "公开提交邮箱门禁：$1" >&2
  echo "请改用已确认的 GitHub noreply 或个人公开邮箱。" >&2
  exit 1
}

EMAIL_GATE_FORBIDDEN_DOMAINS=$(git config --local --get-all travelGuide.forbiddenEmailDomain 2>/dev/null || true)
[ -n "$EMAIL_GATE_FORBIDDEN_DOMAINS" ] || email_gate_fail "本仓库未配置 travelGuide.forbiddenEmailDomain，为避免门禁静默失效已停止操作。"

email_gate_check_email() {
  label=$1
  email=$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')
  case "$email" in
    *@*) domain=${email##*@} ;;
    *) email_gate_fail "$label 为空或格式无效。" ;;
  esac

  old_ifs=$IFS
  IFS='
'
  for forbidden in $EMAIL_GATE_FORBIDDEN_DOMAINS; do
    forbidden=$(printf '%s' "$forbidden" | tr '[:upper:]' '[:lower:]' | sed 's/^@//;s/^\.//;s/\.$//')
    case "$forbidden" in
      ''|*[!a-z0-9.-]*) IFS=$old_ifs; email_gate_fail "本仓库禁用邮箱域配置无效。" ;;
    esac
    case "$domain" in
      "$forbidden"|*."$forbidden") IFS=$old_ifs; email_gate_fail "$label 命中禁用域。" ;;
    esac
  done
  IFS=$old_ifs
}

email_gate_email_from_ident() {
  printf '%s' "$1" | sed -n 's/.*<\([^>]*\)>.*/\1/p'
}

email_gate_check_commit() {
  sha=$1
  author_email=$(git show -s --format='%ae' "$sha" 2>/dev/null) || email_gate_fail "无法读取待推送提交 $sha 的作者邮箱。"
  committer_email=$(git show -s --format='%ce' "$sha" 2>/dev/null) || email_gate_fail "无法读取待推送提交 $sha 的提交者邮箱。"
  email_gate_check_email "提交 $sha 的作者邮箱" "$author_email"
  email_gate_check_email "提交 $sha 的提交者邮箱" "$committer_email"
}
