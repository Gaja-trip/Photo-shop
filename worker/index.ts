/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  handlePhotoApi,
  type DriveUploadEnv,
} from "./drive-upload";

interface Env extends DriveUploadEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/photos") {
      return handlePhotoApi(request, env);
    }

    const legacyAssetRoutes: Record<string, string> = {
      "/booth": "/index.html",
      "/booth/": "/index.html",
      "/booth/index.html": "/index.html",
      "/booth/styles.css": "/styles.css",
      "/booth/src/app.js": "/app.js",
      "/booth/assets/backgrounds/paris-golden-hour.png":
        "/paris-golden-hour.png",
      "/src/app.js": "/app.js",
      "/assets/backgrounds/paris-golden-hour.png": "/paris-golden-hour.png",
    };
    const redirectTarget = legacyAssetRoutes[url.pathname];
    if (redirectTarget) {
      return Response.redirect(new URL(redirectTarget, request.url), 308);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
