/**
 * 认证与工单 API 客户端 —— 全部走 wordEditor 自有后端（/api/*，vite 代理到 8787）。
 * 登录/注册由自有后端代理转发 AuthCenter（浏览器只见密文）；工单/附件是自有业务。
 */

import { apiFetch } from "./apiFetch";
import { encryptCredential } from "./credentialCrypto";

const BASE = "/api";
const LS_KEY = "wordeditor.auth";

export interface AuthUser {
  userId: number;
  username: string;
  accessToken: string;
  roleCodes: string[];
  currentRoleCode?: string;
}

export interface DocOrder {
  id: number;
  orderNo: string;
  type: "template" | "document";
  title: string;
  requirement: string;
  status:
    | "placed"
    | "producing"
    | "checking"
    | "rework"
    | "delivered"
    | "cancelled";
  customerId: number;
  customerName: string;
  workerId: number | null;
  workerName: string | null;
  /** kind 决定它出现在「需求附件」还是「交付附件」分组里 */
  attachments: {
    id: number;
    kind: 'requirement' | 'deliverable';
    name: string;
    url: string;
    size?: number | null;
    uploadedBy: string;
    uploadedAt: string;
  }[];
  timeline: { status: string; by: string; byUserId: number; note?: string; at: string }[];
  createTime: string;
  updateTime: string;
}

// ---------------------------------------------------------------- 登录态

let cached: AuthUser | null = null;

export function currentUser(): AuthUser | null {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) cached = JSON.parse(raw) as AuthUser;
  } catch {
    /* 忽略损坏的本地数据 */
  }
  return cached;
}

function setAuth(user: AuthUser | null): void {
  cached = user;
  if (user) localStorage.setItem(LS_KEY, JSON.stringify(user));
  else localStorage.removeItem(LS_KEY);
  window.dispatchEvent(new Event("wordeditor.auth-changed"));
}

export function logout(): void {
  setAuth(null);
}

/** 是否可操作工单（员工 / 管理员） */
export function isWorker(user: AuthUser | null): boolean {
  if (!user) return false;
  return user.roleCodes.some((r) => ["doc-worker", "admin", "SUPER_ADMIN"].includes(r));
}

/** 是否超级管理员（只有站主可见「关于」等内部技术页面）。
 *  注意：AuthCenter 里 name=「超级管理员」的角色 code 是 admin，站主挂的通常是它。 */
export function isAdmin(user: AuthUser | null): boolean {
  if (!user) return false;
  return user.roleCodes.some((r) => ["SUPER_ADMIN", "admin"].includes(r));
}

// ---------------------------------------------------------------- 请求

async function call<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  // 无 body 的动作端点（accept/deliver/cancel）不能带 Content-Type，
  // 否则 Fastify 会因「声明 json 却没有 body」回 400
  const headers: Record<string, string> = options.body
    ? { "Content-Type": "application/json" }
    : {};
  const user = currentUser();
  if (options.auth !== false && user) {
    headers.Authorization = `Bearer ${user.accessToken}`;
  }
  // 登录/注册是公开端点，不走带 401 广播的 apiFetch，避免登录失败时又弹一次登录框
  const send = options.auth === false ? fetch : apiFetch;
  const res = await send(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  }) as Response;
  const payload = (await res.json().catch(() => ({}))) as {
    code?: number;
    message?: string;
    data?: T;
    accessToken?: string;
    refreshToken?: string;
    success?: boolean;
  };
  if (!res.ok || (payload.code && payload.code !== 200)) {
    throw new Error(payload.message || `请求失败 (HTTP ${res.status})`);
  }
  // 后端两种返回体都要接得住：
  //   工单/上传路由直接回业务对象（{orders:[...]}/{order:{...}}），没有外层信封；
  //   登录/注册代理透传 AuthCenter 的双层信封（{code,data:{...}}）。
  return ("data" in payload ? (payload.data as T) : (payload as unknown as T));
}

// ---------------------------------------------------------------- 认证

/**
 * AuthCenter 的业务错误包在外层 200 里：
 * `{code:200, data:{code:401, success:false, message:"用户名或密码错误"}}`，
 * 成功时数据在 data.data。这里统一拆包 + 透传内层错误。
 */
function unwrapAuth<T>(envelope: unknown): T {
  const inner = envelope as { code?: number; success?: boolean; message?: string; data?: T };
  if (inner && typeof inner === "object" && "success" in inner) {
    if (inner.success === false || (inner.code !== undefined && inner.code !== 200)) {
      throw new Error(inner.message || "认证失败");
    }
    return inner.data as T;
  }
  return envelope as T;
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const raw = await call<Record<string, any>>("/auth/login", {
    method: "POST",
    auth: false,
    body: { username, password: encryptCredential(password) },
  });
  const data = unwrapAuth<Record<string, any>>(raw);
  const accessToken = data?.accessToken;
  if (!accessToken) throw new Error("登录响应缺少 token");

  // JWT 载荷里带 userId/username/roleCodes（见 jwt.strategy validate）
  const payloadOf = (t: string): Record<string, any> => {
    try {
      return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    } catch {
      return {};
    }
  };
  const claims = payloadOf(accessToken);
  const user: AuthUser = {
    userId: Number(data.userId ?? claims.userId ?? 0),
    username: String(data.username ?? claims.username ?? username),
    accessToken,
    roleCodes: (claims.roleCodes as string[]) ?? [],
    currentRoleCode: claims.currentRoleCode,
  };
  setAuth(user);
  return user;
}

export async function register(username: string, password: string): Promise<void> {
  const raw = await call<Record<string, any>>("/auth/register", {
    method: "POST",
    auth: false,
    body: { username, password: encryptCredential(password) },
  });
  unwrapAuth<Record<string, any>>(raw);
}

// ---------------------------------------------------------------- 工单

export interface UploadedFile {
  name: string;
  url: string;
  size: number;
  uploadedBy: string;
}

export const docOrderApi = {
  /** 上传附件：multipart 直传自有后端，返回可回填进 create/submit 的 url */
  upload: async (file: File): Promise<UploadedFile> => {
    const user = currentUser();
    const fd = new FormData();
    fd.append("file", file);
    const res = await apiFetch(`${BASE}/doc-order-uploads`, {
      method: "POST",
      headers: user ? { Authorization: `Bearer ${user.accessToken}` } : undefined,
      body: fd,
    });
    const payload = (await res.json().catch(() => ({}))) as { message?: string } & UploadedFile;
    if (!res.ok) throw new Error(payload.message || `上传失败 (HTTP ${res.status})`);
    return payload as UploadedFile;
  },

  create: (body: {
    type: string;
    title: string;
    requirement?: string;
    attachments?: { name: string; url: string; size?: number }[];
  }) => call<{ order: DocOrder }>("/doc-orders", { method: "POST", body }).then((r) => r.order),

  my: () => call<{ orders: DocOrder[] }>("/doc-orders/my").then((r) => r.orders),

  queue: () => call<{ orders: DocOrder[] }>("/doc-orders/queue").then((r) => r.orders),

  accept: (id: number) => call<{ order: DocOrder }>(`/doc-orders/${id}/accept`, { method: "POST" }).then((r) => r.order),

  submit: (id: number, body: { note?: string; attachments?: { name: string; url: string; size?: number }[] }) =>
    call<{ order: DocOrder }>(`/doc-orders/${id}/submit`, { method: "POST", body }).then((r) => r.order),

  deliver: (id: number) => call<{ order: DocOrder }>(`/doc-orders/${id}/deliver`, { method: "POST" }).then((r) => r.order),

  rework: (id: number, note: string) =>
    call<{ order: DocOrder }>(`/doc-orders/${id}/rework`, { method: "POST", body: { note } }).then((r) => r.order),

  cancel: (id: number) => call<{ order: DocOrder }>(`/doc-orders/${id}/cancel`, { method: "POST" }).then((r) => r.order),
};

// ---------------------------------------------------------------- 下载中心

export interface DownloadItem {
  name: string;
  size: number;
  updateTime: string;
  url: string;
}

export const downloadApi = {
  /** 列出 COS 下载中心里的安装包（登录即可），url 是限时预签名直链 */
  list: () => call<{ items: DownloadItem[]; prefix: string }>("/downloads").then((r) => r.items),

  /** 下载单个文件：预签名直链自带鉴权签名，浏览器/系统下载器直接拉 COS，免 Authorization 头 */
  download: async (item: DownloadItem): Promise<void> => {
    const a = document.createElement("a");
    a.href = item.url;
    a.rel = "noopener";
    a.click();
  },
};
