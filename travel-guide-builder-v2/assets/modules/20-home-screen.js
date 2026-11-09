/* ── 20  home screen ── */
function initHomeScreen(root) {
  const button = root.querySelector("[data-guide-home-screen]");
  const dialog = root.querySelector("[data-guide-home-screen-dialog]");
  const view = root.defaultView;
  if (!button || !dialog || view?.location.protocol !== "https:" || button.dataset.homeScreenReady) return;
  button.dataset.homeScreenReady = "true";

  const userAgent = view.navigator.userAgent;
  const isAppleMobile = /iPhone|iPad|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && view.navigator.maxTouchPoints > 1);
  const instructions = isAppleMobile
    ? "用 Safari 打开这份攻略，点「分享」→「添加到主屏幕」。如果看到「作为网页 App 打开」，请开启。"
    : /Android/.test(userAgent)
      ? "在浏览器菜单里选「安装应用」或「添加到主屏幕」。如果当前应用没有这个选项，请用 Chrome 打开这份攻略。"
      : /Macintosh/.test(userAgent)
        ? "在 Safari 里选择「文件」→「添加到程序坞」。也可以使用浏览器地址栏或菜单里的安装选项。"
        : "在浏览器地址栏或菜单里选择「安装应用」或「将此页面安装为应用」。";
  const standalone = view.matchMedia?.("(display-mode: standalone)");
  let installed = false;
  let pendingPrompt;
  const sync = () => { button.hidden = Boolean(installed || standalone?.matches || view.navigator.standalone); };
  const returnFocus = () => root.querySelector("[data-guide-floating-toggle]")?.focus();
  const close = dialog.querySelector("[data-guide-home-screen-close]");
  const showInstructions = () => {
    dialog.querySelector("[data-guide-home-screen-help]").textContent = instructions;
    dialog.showModal();
    close.focus();
  };

  view.addEventListener("beforeinstallprompt", event => {
    if (typeof event.prompt !== "function") return;
    event.preventDefault();
    pendingPrompt = event;
  });
  view.addEventListener("appinstalled", () => {
    installed = true;
    pendingPrompt = undefined;
    sync();
  });
  standalone?.addEventListener?.("change", sync);
  button.addEventListener("click", async () => {
    if (!pendingPrompt) {
      showInstructions();
      return;
    }
    const event = pendingPrompt;
    pendingPrompt = undefined;
    returnFocus();
    try {
      await event.prompt();
    } catch {
      showInstructions();
    }
  });
  dialog.addEventListener("close", returnFocus);
  sync();
}
