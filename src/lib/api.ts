export class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let adminCsrfToken: string | null = null;

function isAdminApiRequest(url: string) {
  return url.startsWith("/api/admin");
}

function isAdminWriteMethod(method: string | undefined) {
  const normalized = (method ?? "GET").toUpperCase();
  return normalized === "POST" || normalized === "PATCH" || normalized === "PUT" || normalized === "DELETE";
}

function extractAdminCsrfToken(payload: unknown) {
  if (typeof payload !== "object" || !payload || !("csrfToken" in payload)) {
    return null;
  }

  const token = (payload as { csrfToken?: unknown }).csrfToken;
  return typeof token === "string" && token.trim() ? token.trim() : null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const isAdminRequest = isAdminApiRequest(url);
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      ...(init?.body == null ? {} : { "Content-Type": "application/json" }),
      ...(isAdminRequest && isAdminWriteMethod(method) && !url.endsWith("/login") && adminCsrfToken
        ? { "X-Admin-CSRF": adminCsrfToken }
        : {}),
      ...(init?.headers ?? {})
    },
    ...init
  });

  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    if (isAdminRequest && response.status === 401) {
      adminCsrfToken = null;
    }
    const message =
      typeof payload === "object" && payload && "message" in payload
        ? String((payload as { message?: unknown }).message ?? "请求失败")
        : typeof payload === "string" && payload
          ? payload
          : "请求失败";
    throw new HttpError(message, response.status);
  }

  if (isAdminRequest) {
    const nextCsrfToken = extractAdminCsrfToken(payload);
    if (nextCsrfToken) {
      adminCsrfToken = nextCsrfToken;
    } else if (url.endsWith("/logout")) {
      adminCsrfToken = null;
    }
  }

  return payload as T;
}

export function getJson<T>(url: string) {
  return request<T>(url);
}

export function postJson<T>(url: string, body?: unknown, method = "POST") {
  return request<T>(url, {
    method,
    body: body == null ? undefined : JSON.stringify(body)
  });
}

export function patchJson<T>(url: string, body?: unknown) {
  return postJson<T>(url, body, "PATCH");
}

export function deleteJson<T>(url: string, body?: unknown) {
  return request<T>(url, {
    method: "DELETE",
    body: body == null ? undefined : JSON.stringify(body)
  });
}
