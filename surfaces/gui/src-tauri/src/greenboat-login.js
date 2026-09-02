(() => {
  if (window.top !== window || location.origin !== "https://imwork.syncotechai.com:8663") return;
  clearInterval(window.__greenboatLoginTimer);
  const check = async () => {
    const text = document.body?.innerText || "";
    const loginPage = /更多登录方式|账号密码|扫码登录|手机号登录/.test(text);
    const search = document.querySelector('input[placeholder*="关键字"], input[placeholder*="关键词"]');
    const messagePage = location.pathname.startsWith("/woa/") &&
      Boolean(search) && /开启消息通知|绿舟应用|及时接收消息提醒/.test(text);
    const loggedIn = loginPage ? false : messagePage ? true : null;
    try {
      // The remote capability permits only event emission, not access to native APIs.
      await window.__TAURI__.event.emitTo("main", "greenboat-login-status", { logged_in: loggedIn });
    } catch (error) {
      console.warn("Greenboat login status delivery failed", error);
    }
  };
  window.__greenboatLoginTimer = setInterval(check, 3000);
  void check();
})();
