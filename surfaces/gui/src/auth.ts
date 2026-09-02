export interface RuoyiUser {
  userId: string;
  userName: string;
  nickName?: string;
  avatar?: string;
  token: string;
}

const RUOYI_BASE = ((import.meta as any).env?.VITE_APP_RUOYI_BASE_URL || "https://ogw.syncotechai.com/").replace(/\/$/, "");
const SSO_LOGIN = (import.meta as any).env?.VITE_APP_SSO_LOGIN_URL || "https://identity.syncotechai.com/loginSso";
const SSO_AK = (import.meta as any).env?.VITE_APP_SSO_AK || "";

export function beginSsoLogin() {
  const path = `${location.pathname}${location.search}${location.hash}`;
  localStorage.setItem("redirectPath:user", path);
  const redirect = `${location.origin}${location.pathname}`;
  const query = new URLSearchParams({ redirect, ak: SSO_AK });
  location.replace(`${SSO_LOGIN}?${query.toString()}`);
}

export async function resolveRuoyiSession(): Promise<RuoyiUser | null> {
  const params = new URLSearchParams(location.search);
  const callbackToken = params.get("token");
  const token = callbackToken || localStorage.getItem("console_token");
  if (!token) return null;
  if (callbackToken) {
    localStorage.setItem("console_token", token);
    params.delete("token");
    const clean = `${location.pathname}${params.toString() ? `?${params}` : ""}${location.hash}`;
    history.replaceState(null, "", clean);
  }
  const response = await fetch(`${RUOYI_BASE}/ry/getInfo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) {
    localStorage.removeItem("console_token");
    localStorage.removeItem("userInfo");
    beginSsoLogin();
    return null;
  }
  if (!response.ok) throw new Error(`若依用户信息请求失败: ${response.status}`);
  const payload = await response.json();
  const user = payload.user || payload.data;
  if (payload.code !== 200 || !user) throw new Error(payload.msg || "用户信息无效");
  const session: RuoyiUser = { userId: String(user.userId), userName: String(user.userName || ""), nickName: user.nickName, avatar: user.avatar, token };
  localStorage.setItem("userInfo", JSON.stringify(session));
  return session;
}

export async function logoutRuoyi(): Promise<void> {
  const token = localStorage.getItem("console_token");
  if (token) {
    await fetch(`${RUOYI_BASE}/ry/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  }
  localStorage.removeItem("console_token");
  localStorage.removeItem("userInfo");
}
