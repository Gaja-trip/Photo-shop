const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const TARGET_FOLDER_NAME = "Photo-Mix";

export interface DriveUploadEnv {
  APPS_SCRIPT_UPLOAD_URL?: string;
  APPS_SCRIPT_UPLOAD_HMAC_SECRET?: string;
  UPLOAD_ALLOWED_ORIGINS?: string;
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isConfigured(env: DriveUploadEnv): boolean {
  return Boolean(
    env.APPS_SCRIPT_UPLOAD_URL?.startsWith("https://script.google.com/") &&
      env.APPS_SCRIPT_UPLOAD_HMAC_SECRET &&
      env.APPS_SCRIPT_UPLOAD_HMAC_SECRET.length >= 32,
  );
}

function isAllowedOrigin(request: Request, env: DriveUploadEnv): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;

  const requestOrigin = new URL(request.url).origin;
  const configuredOrigins = (env.UPLOAD_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return origin === requestOrigin || configuredOrigins.includes(origin);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function safeFilename(value: string | null): string {
  let decoded = "";
  try {
    decoded = decodeURIComponent(value || "");
  } catch {
    decoded = "";
  }
  const sanitized = decoded
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 100);
  const stem = sanitized.replace(/\.(jpe?g)$/i, "") || "오늘-사진";
  return `${stem}.jpg`;
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function handlePhotoApi(
  request: Request,
  env: DriveUploadEnv,
): Promise<Response> {
  if (request.method === "GET") {
    return jsonResponse({
      ok: true,
      configured: isConfigured(env),
      folderName: TARGET_FOLDER_NAME,
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(
      { ok: false, code: "METHOD_NOT_ALLOWED" },
      405,
    );
  }

  if (!isAllowedOrigin(request, env)) {
    return jsonResponse({ ok: false, code: "ORIGIN_NOT_ALLOWED" }, 403);
  }

  if (!isConfigured(env)) {
    return jsonResponse(
      {
        ok: false,
        code: "DRIVE_NOT_CONFIGURED",
        message: "Google Drive upload is not configured.",
      },
      503,
    );
  }

  const contentType = (request.headers.get("Content-Type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== "image/jpeg") {
    return jsonResponse(
      { ok: false, code: "UNSUPPORTED_MEDIA_TYPE" },
      415,
    );
  }

  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_PHOTO_BYTES) {
    return jsonResponse({ ok: false, code: "PHOTO_TOO_LARGE" }, 413);
  }

  const uploadId = request.headers.get("X-Upload-Id") || "";
  if (!/^[a-zA-Z0-9-]{16,96}$/.test(uploadId)) {
    return jsonResponse({ ok: false, code: "INVALID_UPLOAD_ID" }, 400);
  }

  const arrayBuffer = await request.arrayBuffer();
  if (!arrayBuffer.byteLength || arrayBuffer.byteLength > MAX_PHOTO_BYTES) {
    return jsonResponse({ ok: false, code: "PHOTO_TOO_LARGE" }, 413);
  }

  const filename = safeFilename(
    request.headers.get("X-Photo-Filename"),
  );
  const payload = JSON.stringify({
    timestamp: Date.now(),
    nonce: crypto.randomUUID(),
    uploadId,
    filename,
    mimeType: contentType,
    data: bytesToBase64(new Uint8Array(arrayBuffer)),
  });
  const signature = await signPayload(
    payload,
    env.APPS_SCRIPT_UPLOAD_HMAC_SECRET!,
  );

  try {
    const upstream = await fetch(env.APPS_SCRIPT_UPLOAD_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload, signature }),
      redirect: "follow",
    });
    const result = (await upstream.json().catch(() => null)) as {
      ok?: boolean;
      code?: string;
      name?: string;
      id?: string;
      url?: string;
    } | null;

    if (!upstream.ok || !result?.ok) {
      console.warn("Drive webhook rejected an upload.", {
        status: upstream.status,
        code: result?.code || "INVALID_RESPONSE",
      });
      return jsonResponse(
        {
          ok: false,
          code: result?.code || "DRIVE_UPSTREAM_FAILED",
          message: "Google Drive did not accept the upload.",
        },
        upstream.status === 429 ? 429 : 502,
      );
    }

    return jsonResponse({
      ok: true,
      id: result.id,
      name: result.name || filename,
      url: result.url,
      folderName: TARGET_FOLDER_NAME,
    });
  } catch (error) {
    console.warn("Drive webhook request failed.", error);
    return jsonResponse(
      {
        ok: false,
        code: "DRIVE_UPSTREAM_UNAVAILABLE",
        message: "Google Drive is temporarily unavailable.",
      },
      502,
    );
  }
}
