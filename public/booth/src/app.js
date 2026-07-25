const byId = (id) => document.getElementById(id);

const previewCanvas = byId("previewCanvas");
const previewContext = previewCanvas.getContext("2d", {
  alpha: false,
  desynchronized: true,
});
const cameraVideo = byId("cameraVideo");
const portraitSource = byId("portraitSource");
const cameraStage = byId("cameraStage");
const aiStatus = byId("aiStatus");
const captureButton = byId("captureButton");
const switchCameraButton = byId("switchCameraButton");
const mirrorButton = byId("mirrorButton");
const countdownElement = byId("countdown");
const flashElement = byId("flash");
const cameraMessage = byId("cameraMessage");
const portraitUpload = byId("portraitUpload");
const backgroundUpload = byId("backgroundUpload");
const resultDialog = byId("resultDialog");
const resultImage = byId("resultImage");
const toast = byId("toast");

const DEFAULT_BACKGROUND_PATH = "./assets/backgrounds/paris-golden-hour.png";
const MEDIAPIPE_VERSION = "0.10.35";
const MEDIAPIPE_MODULE =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
const MEDIAPIPE_WASM =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const SELFIE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
const PREVIEW_WIDTH = 720;
const PREVIEW_HEIGHT = 900;
const EXPORT_WIDTH = 1080;
const EXPORT_HEIGHT = 1350;
const SEGMENTATION_INTERVAL = 92;
const MAX_INFERENCE_EDGE = 960;
const MAX_STILL_INFERENCE_EDGE = 1280;

const defaultBackground = new Image();
defaultBackground.decoding = "async";
defaultBackground.src = DEFAULT_BACKGROUND_PATH;

const state = {
  backgroundImage: defaultBackground,
  customBackground: null,
  customBackgroundUrl: "",
  backgroundTone: "golden",
  look: "natural",
  personScale: 0.9,
  personOffsetY: 0,
  shadowStrength: 0.55,
  sourceType: null,
  portraitUrl: "",
  stream: null,
  facingMode: "user",
  mirror: true,
  segmenter: null,
  segmenterPromise: null,
  segmenterState: "idle",
  segmenterDelegate: null,
  visionTasks: null,
  visionFiles: null,
  cpuRecoveryStarted: false,
  isSegmenting: false,
  lastSegmentedAt: 0,
  lastVideoTime: -1,
  maskCanvas: document.createElement("canvas"),
  segmentationFrameCanvas: document.createElement("canvas"),
  imageInferenceCanvas: document.createElement("canvas"),
  maskAvailable: false,
  maskUpdatedAt: 0,
  personBounds: null,
  staticMaskRequested: false,
  resultBlob: null,
  resultUrl: "",
  renderHandle: 0,
  lastRenderedAt: 0,
  captureInProgress: false,
  sourceWasCamera: false,
  cameraPausedAfterCapture: false,
  cameraRequestId: 0,
  toastTimer: 0,
};

const personLayer = document.createElement("canvas");
const softMaskLayer = document.createElement("canvas");
const exportCanvas = document.createElement("canvas");
const captureFrameCanvas = document.createElement("canvas");
exportCanvas.width = EXPORT_WIDTH;
exportCanvas.height = EXPORT_HEIGHT;

function waitForImage(image) {
  if (image.complete && image.naturalWidth) {
    return Promise.resolve(image);
  }

  return new Promise((resolve, reject) => {
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", reject, { once: true });
  });
}

function getSource() {
  if (state.sourceType === "video" && cameraVideo.readyState >= 2) {
    return cameraVideo;
  }
  if (state.sourceType === "image" && portraitSource.complete && portraitSource.naturalWidth) {
    return portraitSource;
  }
  return null;
}

function getSourceSize(source) {
  if (source instanceof HTMLVideoElement) {
    return {
      width: source.videoWidth || 1280,
      height: source.videoHeight || 720,
    };
  }

  return {
    width: source.naturalWidth || source.width,
    height: source.naturalHeight || source.height,
  };
}

function snapshotSource(source, targetCanvas, maxEdge) {
  const sourceSize = getSourceSize(source);
  const scale = Math.min(1, maxEdge / Math.max(sourceSize.width, sourceSize.height));
  const width = Math.max(1, Math.round(sourceSize.width * scale));
  const height = Math.max(1, Math.round(sourceSize.height * scale));
  targetCanvas.width = width;
  targetCanvas.height = height;
  const context = targetCanvas.getContext("2d", { alpha: false });
  context.drawImage(source, 0, 0, width, height);
  return targetCanvas;
}

function getCoverCrop(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;

  if (sourceRatio > targetRatio) {
    const cropWidth = sourceHeight * targetRatio;
    return {
      x: (sourceWidth - cropWidth) / 2,
      y: 0,
      width: cropWidth,
      height: sourceHeight,
    };
  }

  const cropHeight = sourceWidth / targetRatio;
  return {
    x: 0,
    y: (sourceHeight - cropHeight) / 2,
    width: sourceWidth,
    height: cropHeight,
  };
}

function drawCropped(
  context,
  image,
  crop,
  targetWidth,
  targetHeight,
  { mirror = false, filter = "none", alpha = 1 } = {},
) {
  context.save();
  context.filter = filter;
  context.globalAlpha = alpha;

  if (mirror) {
    context.translate(targetWidth, 0);
    context.scale(-1, 1);
  }

  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    targetWidth,
    targetHeight,
  );
  context.restore();
}

function getBackgroundFilter() {
  const filters = {
    golden: "brightness(1.02) saturate(.97) contrast(.98)",
    film: "brightness(.99) saturate(.72) sepia(.16) contrast(.92)",
    rose: "brightness(1.06) saturate(1.03) sepia(.13) hue-rotate(338deg)",
    custom: "brightness(1.01) saturate(.96) contrast(.98)",
  };
  return filters[state.backgroundTone] || filters.golden;
}

function getPortraitFilter() {
  const filters = {
    natural: "brightness(1.035) saturate(.96) contrast(.97)",
    "paris-film": "brightness(1.01) saturate(.83) sepia(.08) contrast(.94)",
    lumiere: "brightness(1.075) saturate(1.02) sepia(.05) contrast(.94)",
  };
  return filters[state.look] || filters.natural;
}

function drawBackground(context, width, height) {
  const image = state.backgroundImage;
  if (!image?.naturalWidth) {
    context.fillStyle = "#c9bba7";
    context.fillRect(0, 0, width, height);
    return;
  }

  const crop = getCoverCrop(image.naturalWidth, image.naturalHeight, width, height);
  drawCropped(context, image, crop, width, height, {
    filter: getBackgroundFilter(),
  });

  const atmosphericWash = context.createLinearGradient(0, 0, width, height);
  atmosphericWash.addColorStop(0, "rgba(255, 245, 224, .08)");
  atmosphericWash.addColorStop(0.58, "rgba(255, 255, 255, 0)");
  atmosphericWash.addColorStop(1, "rgba(43, 47, 37, .06)");
  context.fillStyle = atmosphericWash;
  context.fillRect(0, 0, width, height);
}

function ensureLayerSize(layer, width, height) {
  if (layer.width !== width || layer.height !== height) {
    layer.width = width;
    layer.height = height;
  }
}

function getLayerPersonBounds(sourceCrop, sourceSize, width, height) {
  if (!state.personBounds) return null;

  let left =
    ((state.personBounds.left * sourceSize.width - sourceCrop.x) /
      sourceCrop.width) *
    width;
  let right =
    ((state.personBounds.right * sourceSize.width - sourceCrop.x) /
      sourceCrop.width) *
    width;
  const top =
    ((state.personBounds.top * sourceSize.height - sourceCrop.y) /
      sourceCrop.height) *
    height;
  const bottom =
    ((state.personBounds.bottom * sourceSize.height - sourceCrop.y) /
      sourceCrop.height) *
    height;

  if (state.mirror) {
    const mirroredLeft = width - right;
    right = width - left;
    left = mirroredLeft;
  }

  return {
    left,
    right,
    top,
    bottom,
    centerX: (left + right) / 2,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function getPersonPlacement(width, height, personBounds) {
  const scale = state.personScale;
  const drawWidth = width * scale;
  const drawHeight = height * scale;

  if (personBounds) {
    return {
      x: width / 2 - personBounds.centerX * scale,
      y:
        height * 0.965 -
        personBounds.bottom * scale +
        height * state.personOffsetY,
      width: drawWidth,
      height: drawHeight,
      groundX: width / 2,
      groundY: height * 0.965 + height * state.personOffsetY,
      subjectWidth: personBounds.width * scale,
    };
  }

  return {
    x: (width - drawWidth) / 2,
    y: height - drawHeight + height * state.personOffsetY,
    width: drawWidth,
    height: drawHeight,
    groundX: width / 2,
    groundY: height * 0.91 + height * state.personOffsetY,
    subjectWidth: width * 0.46 * scale,
  };
}

function drawGroundingShadow(context, width, height, placement) {
  if (state.shadowStrength <= 0) return;
  context.save();
  const shadow = context.createRadialGradient(
    placement.groundX,
    placement.groundY,
    width * 0.03,
    placement.groundX,
    placement.groundY,
    Math.max(width * 0.1, placement.subjectWidth * 0.62),
  );
  shadow.addColorStop(0, `rgba(38, 28, 18, ${0.34 * state.shadowStrength})`);
  shadow.addColorStop(0.48, `rgba(38, 28, 18, ${0.18 * state.shadowStrength})`);
  shadow.addColorStop(1, "rgba(38, 28, 18, 0)");
  context.scale(1, 0.32);
  context.fillStyle = shadow;
  context.beginPath();
  context.ellipse(
    placement.groundX,
    placement.groundY / 0.32,
    Math.max(width * 0.1, placement.subjectWidth * 0.62),
    height * 0.09,
    0,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.restore();
}

function drawSoftPortraitMask(context, width, height) {
  context.clearRect(0, 0, width, height);
  context.save();
  context.filter = `blur(${Math.max(12, width * 0.027)}px)`;

  const headGradient = context.createRadialGradient(
    width * 0.5,
    height * 0.24,
    width * 0.07,
    width * 0.5,
    height * 0.24,
    width * 0.19,
  );
  headGradient.addColorStop(0, "rgba(255,255,255,1)");
  headGradient.addColorStop(0.72, "rgba(255,255,255,.98)");
  headGradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = headGradient;
  context.fillRect(0, 0, width, height * 0.49);

  const bodyGradient = context.createRadialGradient(
    width * 0.5,
    height * 0.62,
    width * 0.15,
    width * 0.5,
    height * 0.62,
    width * 0.48,
  );
  bodyGradient.addColorStop(0, "rgba(255,255,255,1)");
  bodyGradient.addColorStop(0.56, "rgba(255,255,255,.96)");
  bodyGradient.addColorStop(0.82, "rgba(255,255,255,.72)");
  bodyGradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = bodyGradient;
  context.fillRect(0, height * 0.25, width, height * 0.82);

  const lowerFade = context.createLinearGradient(0, height * 0.58, 0, height);
  lowerFade.addColorStop(0, "rgba(255,255,255,.12)");
  lowerFade.addColorStop(0.32, "rgba(255,255,255,.94)");
  lowerFade.addColorStop(1, "rgba(255,255,255,1)");
  context.globalCompositeOperation = "source-in";
  context.fillStyle = lowerFade;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function applyPortraitMask(context, sourceCrop, sourceSize, width, height, useAiMask) {
  context.globalCompositeOperation = "destination-in";

  if (useAiMask) {
    const maskCrop = {
      x: (sourceCrop.x / sourceSize.width) * state.maskCanvas.width,
      y: (sourceCrop.y / sourceSize.height) * state.maskCanvas.height,
      width: (sourceCrop.width / sourceSize.width) * state.maskCanvas.width,
      height: (sourceCrop.height / sourceSize.height) * state.maskCanvas.height,
    };
    context.save();
    context.filter = `blur(${Math.max(0.7, width * 0.0017)}px)`;
    drawCropped(context, state.maskCanvas, maskCrop, width, height, {
      mirror: state.mirror,
    });
    context.restore();
    return;
  }

  ensureLayerSize(softMaskLayer, width, height);
  drawSoftPortraitMask(softMaskLayer.getContext("2d"), width, height);
  context.drawImage(softMaskLayer, 0, 0, width, height);
}

function drawColorHarmony(context, width, height, hasPortrait) {
  if (hasPortrait) {
    context.save();
    context.globalCompositeOperation = "soft-light";
    context.globalAlpha = state.look === "lumiere" ? 0.15 : 0.09;
    const lightMatch = context.createLinearGradient(0, 0, width, height);
    lightMatch.addColorStop(0, "#ffe4b5");
    lightMatch.addColorStop(0.45, "#fff3dd");
    lightMatch.addColorStop(1, "#435d5d");
    context.fillStyle = lightMatch;
    context.fillRect(0, 0, width, height);
    context.restore();
  }

  context.save();
  if (state.look === "paris-film") {
    context.globalCompositeOperation = "soft-light";
    context.globalAlpha = 0.13;
    context.fillStyle = "#9d745d";
    context.fillRect(0, 0, width, height);
  } else if (state.look === "lumiere") {
    context.globalCompositeOperation = "screen";
    const glow = context.createRadialGradient(
      width * 0.18,
      height * 0.12,
      0,
      width * 0.18,
      height * 0.12,
      width * 0.7,
    );
    glow.addColorStop(0, "rgba(255, 229, 175, .16)");
    glow.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
  }
  context.restore();

  const vignette = context.createRadialGradient(
    width / 2,
    height * 0.46,
    width * 0.2,
    width / 2,
    height * 0.48,
    width * 0.76,
  );
  vignette.addColorStop(0.58, "rgba(24, 32, 26, 0)");
  vignette.addColorStop(1, state.look === "paris-film" ? "rgba(35, 25, 19, .18)" : "rgba(35, 31, 24, .10)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);
}

function drawFilmGrain(context, width, height) {
  if (state.look !== "paris-film") return;

  context.save();
  context.globalAlpha = 0.08;
  context.fillStyle = "#402f24";
  const spacing = Math.max(5, Math.round(width / 170));
  for (let y = 2; y < height; y += spacing) {
    for (let x = ((y / spacing) % 2) * 2; x < width; x += spacing * 2) {
      const offset = ((x * 13 + y * 7) % 11) / 11;
      context.fillRect(x + offset, y, 0.7, 0.7);
    }
  }
  context.restore();
}

function renderComposite(context, width, height, sourceOverride = null) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.filter = "none";
  context.clearRect(0, 0, width, height);
  drawBackground(context, width, height);

  const source = sourceOverride || getSource();
  if (!source) {
    drawColorHarmony(context, width, height, false);
    context.restore();
    return;
  }

  const sourceSize = getSourceSize(source);
  const sourceCrop = getCoverCrop(sourceSize.width, sourceSize.height, width, height);
  const layerPersonBounds = getLayerPersonBounds(
    sourceCrop,
    sourceSize,
    width,
    height,
  );
  const placement = getPersonPlacement(width, height, layerPersonBounds);
  const useAiMask =
    state.maskAvailable &&
    state.maskCanvas.width > 0 &&
    state.maskCanvas.height > 0 &&
    (state.sourceType === "image" || performance.now() - state.maskUpdatedAt < 1600);

  drawGroundingShadow(context, width, height, placement);

  ensureLayerSize(personLayer, width, height);
  const personContext = personLayer.getContext("2d");
  personContext.setTransform(1, 0, 0, 1, 0, 0);
  personContext.clearRect(0, 0, width, height);
  personContext.globalCompositeOperation = "source-over";

  drawCropped(personContext, source, sourceCrop, width, height, {
    mirror: state.mirror,
    filter: getPortraitFilter(),
  });
  applyPortraitMask(personContext, sourceCrop, sourceSize, width, height, useAiMask);

  personContext.globalCompositeOperation = "source-atop";
  const directionalLight = personContext.createLinearGradient(0, 0, width, 0);
  directionalLight.addColorStop(0, "rgba(255, 218, 158, .18)");
  directionalLight.addColorStop(0.34, "rgba(255, 238, 208, .06)");
  directionalLight.addColorStop(0.68, "rgba(103, 128, 130, 0)");
  directionalLight.addColorStop(1, "rgba(67, 94, 99, .09)");
  personContext.fillStyle = directionalLight;
  personContext.fillRect(0, 0, width, height);

  personContext.globalCompositeOperation = "source-over";
  personContext.filter = "none";

  context.save();
  context.filter = `drop-shadow(0 ${height * 0.004}px ${width * 0.008}px rgba(59, 42, 27, .11))`;
  context.drawImage(
    personLayer,
    placement.x,
    placement.y,
    placement.width,
    placement.height,
  );
  context.restore();

  drawColorHarmony(context, width, height, true);
  drawFilmGrain(context, width, height);
  context.restore();
}

function updateAiStatus(mode, text) {
  aiStatus.classList.remove("is-loading", "is-ready", "is-fallback");
  if (mode) aiStatus.classList.add(`is-${mode}`);
  aiStatus.querySelector("span:last-child").textContent = text;
}

function updateCaptureReadiness() {
  const sourceReady = Boolean(getSource());
  const compositingReady =
    state.maskAvailable || state.segmenterState === "fallback";
  captureButton.disabled =
    state.captureInProgress || !sourceReady || !compositingReady;
}

function closeMaskResources(result) {
  const masks = [
    ...(result?.confidenceMasks || []),
    ...(result?.categoryMask ? [result.categoryMask] : []),
  ];
  masks.forEach((mask) => {
    try {
      mask.close?.();
    } catch {
      // Older MediaPipe builds do not expose close on every mask type.
    }
  });
}

function updateMask(result) {
  if (!result) {
    state.isSegmenting = false;
    return;
  }

  try {
    const confidenceMasks = result.confidenceMasks || [];
    const confidenceMask = confidenceMasks[0];
    const categoryMask = result.categoryMask;
    const mask = confidenceMask || categoryMask;

    if (!mask) {
      state.isSegmenting = false;
      return;
    }

    const width = mask.width;
    const height = mask.height;
    state.maskCanvas.width = width;
    state.maskCanvas.height = height;
    const maskContext = state.maskCanvas.getContext("2d");
    const output = maskContext.createImageData(width, height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    if (confidenceMask?.getAsFloat32Array) {
      const values = confidenceMask.getAsFloat32Array();
      for (let index = 0; index < values.length; index += 1) {
        const confidence = values[index];
        const normalized = Math.max(0, Math.min(1, (confidence - 0.13) / 0.72));
        const feathered = normalized * normalized * (3 - 2 * normalized);
        const alpha = Math.round(feathered * 255);
        const pixelIndex = index * 4;
        output.data[pixelIndex] = 255;
        output.data[pixelIndex + 1] = 255;
        output.data[pixelIndex + 2] = 255;
        output.data[pixelIndex + 3] = alpha;
        if (alpha > 42) {
          const x = index % width;
          const y = Math.floor(index / width);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    } else {
      const values = categoryMask.getAsUint8Array();
      for (let index = 0; index < values.length; index += 1) {
        const pixelIndex = index * 4;
        const isPerson = values[index] > 0;
        output.data[pixelIndex] = 255;
        output.data[pixelIndex + 1] = 255;
        output.data[pixelIndex + 2] = 255;
        output.data[pixelIndex + 3] = isPerson ? 255 : 0;
        if (isPerson) {
          const x = index % width;
          const y = Math.floor(index / width);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      throw new Error("인물 영역을 찾지 못했습니다.");
    }

    maskContext.putImageData(output, 0, 0);
    state.personBounds = {
      left: minX / width,
      top: minY / height,
      right: (maxX + 1) / width,
      bottom: (maxY + 1) / height,
    };
    state.maskAvailable = true;
    state.maskUpdatedAt = performance.now();
    updateAiStatus("ready", "AI 인물 분리 켜짐");
    updateCaptureReadiness();
  } catch (error) {
    console.warn("인물 마스크를 처리하지 못해 소프트 합성으로 전환합니다.", error);
    state.maskAvailable = false;
    state.personBounds = null;
    if (state.segmenterDelegate === "GPU" && !state.cpuRecoveryStarted) {
      updateAiStatus("loading", "호환 모드로 다시 준비 중");
      recoverSegmenterOnCpu();
    } else {
      try {
        state.segmenter?.close?.();
      } catch {
        // Segmenter may already be closed by the runtime.
      }
      state.segmenter = null;
      state.segmenterState = "fallback";
      updateAiStatus("fallback", "소프트 인물 합성");
      updateCaptureReadiness();
    }
  } finally {
    closeMaskResources(result);
    state.isSegmenting = false;
  }
}

async function recoverSegmenterOnCpu() {
  if (
    state.cpuRecoveryStarted ||
    !state.visionTasks ||
    !state.visionFiles
  ) {
    return;
  }

  state.cpuRecoveryStarted = true;
  state.segmenterState = "loading";
  captureButton.disabled = true;
  try {
    state.segmenter?.close?.();
  } catch {
    // Ignore close failures during recovery.
  }
  state.segmenter = null;

  try {
    const segmenter = await state.visionTasks.ImageSegmenter.createFromOptions(
      state.visionFiles,
      {
        baseOptions: {
          modelAssetPath: SELFIE_MODEL,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      },
    );
    state.segmenter = segmenter;
    state.segmenterDelegate = "CPU";
    state.segmenterState = "ready";
    state.segmenterPromise = Promise.resolve(segmenter);
    state.staticMaskRequested = false;
    state.maskAvailable = false;
    state.personBounds = null;
    updateAiStatus("ready", "AI 인물 분리 호환 모드");
  } catch (error) {
    console.warn("AI 인물 분리 호환 모드도 사용할 수 없습니다.", error);
    state.segmenter = null;
    state.segmenterPromise = null;
    state.segmenterState = "fallback";
    updateAiStatus("fallback", "소프트 인물 합성");
    updateCaptureReadiness();
  }
}

async function loadSegmenter() {
  if (state.segmenter) return state.segmenter;
  if (state.segmenterPromise) return state.segmenterPromise;

  state.segmenterState = "loading";
  updateAiStatus("loading", "AI 인물 분리 불러오는 중");

  state.segmenterPromise = (async () => {
    try {
      const visionTasks = await import(MEDIAPIPE_MODULE);
      const vision = await visionTasks.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
      state.visionTasks = visionTasks;
      state.visionFiles = vision;
      let segmenter;

      try {
        segmenter = await visionTasks.ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: SELFIE_MODEL,
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
        state.segmenterDelegate = "GPU";
      } catch {
        segmenter = await visionTasks.ImageSegmenter.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: SELFIE_MODEL,
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
        state.segmenterDelegate = "CPU";
      }

      state.segmenter = segmenter;
      state.cpuRecoveryStarted = state.segmenterDelegate === "CPU";
      state.segmenterState = "ready";
      updateAiStatus("ready", "AI 인물 분리 준비됨");
      return segmenter;
    } catch (error) {
      console.warn("AI 인물 분리 모듈을 불러오지 못했습니다.", error);
      state.segmenterPromise = null;
      state.segmenterState = "fallback";
      updateAiStatus("fallback", "소프트 인물 합성");
      updateCaptureReadiness();
      return null;
    }
  })();

  return state.segmenterPromise;
}

function getSegmentationSource() {
  const source = getSource();
  if (!source) return null;
  if (state.sourceType === "video") {
    return snapshotSource(
      source,
      state.segmentationFrameCanvas,
      MAX_INFERENCE_EDGE,
    );
  }
  return snapshotSource(
    source,
    state.imageInferenceCanvas,
    MAX_STILL_INFERENCE_EDGE,
  );
}

function runSegmentation(timestamp) {
  const source = getSegmentationSource();
  if (!source || !state.segmenter || state.isSegmenting) return;

  if (state.sourceType === "image" && state.staticMaskRequested) return;

  if (
    state.sourceType === "video" &&
    cameraVideo.currentTime === state.lastVideoTime
  ) {
    return;
  }

  state.isSegmenting = true;
  state.lastSegmentedAt = timestamp;
  if (state.sourceType === "image") state.staticMaskRequested = true;
  if (state.sourceType === "video") {
    state.lastVideoTime = cameraVideo.currentTime;
  }

  const inferenceTime = Math.max(Math.round(timestamp), state.maskUpdatedAt + 1);

  try {
    const maybeResult = state.segmenter.segmentForVideo(
      source,
      inferenceTime,
      (result) => updateMask(result),
    );
    if (maybeResult?.categoryMask || maybeResult?.confidenceMasks) {
      updateMask(maybeResult);
    } else {
      window.setTimeout(() => {
        state.isSegmenting = false;
        if (state.sourceType === "image" && !state.maskAvailable) {
          state.segmenterState = "fallback";
          updateAiStatus("fallback", "소프트 인물 합성");
          updateCaptureReadiness();
        }
      }, 400);
    }
  } catch (error) {
    console.warn("이번 프레임의 인물 분리를 건너뜁니다.", error);
    state.isSegmenting = false;
    if (state.sourceType === "image") {
      state.segmenterState = "fallback";
      updateAiStatus("fallback", "소프트 인물 합성");
      updateCaptureReadiness();
    }
  }
}

function renderLoop(timestamp) {
  if (
    !state.captureInProgress &&
    state.segmenter &&
    getSource() &&
    (state.sourceType === "video" || !state.staticMaskRequested) &&
    timestamp - state.lastSegmentedAt >= SEGMENTATION_INTERVAL
  ) {
    runSegmentation(timestamp);
  }

  if (timestamp - state.lastRenderedAt >= 30) {
    const previewSource =
      state.sourceType === "video" && state.maskAvailable
        ? state.segmentationFrameCanvas
        : null;
    renderComposite(
      previewContext,
      PREVIEW_WIDTH,
      PREVIEW_HEIGHT,
      previewSource,
    );
    state.lastRenderedAt = timestamp;
  }
  state.renderHandle = window.requestAnimationFrame(renderLoop);
}

function stopCamera({ invalidatePending = true } = {}) {
  if (invalidatePending) state.cameraRequestId += 1;
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  cameraVideo.srcObject = null;
  switchCameraButton.disabled = true;
}

function showCameraMessage(message) {
  cameraMessage.textContent = message;
  cameraMessage.hidden = !message;
}

function getCameraErrorMessage(error) {
  const messages = {
    NotAllowedError:
      "카메라 권한이 꺼져 있어요. 브라우저 설정에서 허용하거나 ‘사진 불러오기’를 이용해 주세요.",
    NotFoundError:
      "사용할 수 있는 카메라를 찾지 못했어요. 대신 기기에 있는 사진을 불러올 수 있어요.",
    NotReadableError:
      "다른 앱이 카메라를 사용 중인 것 같아요. 다른 앱을 닫고 다시 시도해 주세요.",
    OverconstrainedError:
      "선택한 카메라를 열 수 없어 기본 카메라로 다시 시도해 주세요.",
    SecurityError:
      "카메라는 보안 연결(HTTPS)이나 localhost에서만 사용할 수 있어요.",
  };
  return messages[error?.name] || "카메라를 시작하지 못했어요. 사진 불러오기로 계속할 수 있어요.";
}

async function startCamera() {
  if (state.captureInProgress) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraMessage("이 브라우저에서는 카메라 촬영을 지원하지 않아요. 사진 불러오기를 이용해 주세요.");
    portraitUpload.click();
    return;
  }

  showCameraMessage("");
  captureButton.disabled = true;
  updateAiStatus("loading", "카메라 연결 중");
  const requestId = state.cameraRequestId + 1;
  state.cameraRequestId = requestId;
  stopCamera({ invalidatePending: false });

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: state.facingMode },
        width: { ideal: 1280 },
        height: { ideal: 960 },
        aspectRatio: { ideal: 4 / 3 },
      },
    });

    if (requestId !== state.cameraRequestId) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    state.stream = stream;
    cameraVideo.srcObject = stream;
    await new Promise((resolve) => {
      if (cameraVideo.readyState >= 1) {
        resolve();
        return;
      }
      cameraVideo.addEventListener("loadedmetadata", resolve, { once: true });
    });
    await cameraVideo.play();

    const actualFacingMode = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
    if (actualFacingMode) {
      state.facingMode = actualFacingMode;
      state.mirror = actualFacingMode === "user";
    }
    state.sourceType = "video";
    state.sourceWasCamera = true;
    state.cameraPausedAfterCapture = false;
    state.maskAvailable = false;
    state.personBounds = null;
    state.staticMaskRequested = false;
    state.lastVideoTime = -1;
    cameraStage.classList.add("has-source");
    switchCameraButton.disabled = false;
    mirrorButton.disabled = false;
    mirrorButton.setAttribute("aria-pressed", String(state.mirror));
    updateAiStatus("loading", "AI 인물 분리 준비 중");

    loadSegmenter().then(() => {
      if (!state.segmenter) {
        updateAiStatus("fallback", "소프트 인물 합성");
      }
      updateCaptureReadiness();
    });
  } catch (error) {
    if (requestId !== state.cameraRequestId) return;
    showCameraMessage(getCameraErrorMessage(error));
    updateAiStatus("fallback", "사진 불러오기 사용 가능");
    if (state.sourceType === "image" && getSource()) {
      updateCaptureReadiness();
    } else {
      captureButton.disabled = true;
    }
  }
}

async function switchCamera() {
  if (state.captureInProgress) return;
  state.facingMode = state.facingMode === "user" ? "environment" : "user";
  state.mirror = state.facingMode === "user";
  mirrorButton.setAttribute("aria-pressed", String(state.mirror));
  await startCamera();
}

function toggleMirror() {
  if (!getSource() || state.captureInProgress) return;
  state.mirror = !state.mirror;
  mirrorButton.setAttribute("aria-pressed", String(state.mirror));
  showToast(state.mirror ? "좌우 반전을 켰어요." : "좌우 반전을 껐어요.");
}

function showToast(message, duration = 2600) {
  window.clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, duration);
}

function revokePortraitUrl() {
  if (state.portraitUrl) {
    URL.revokeObjectURL(state.portraitUrl);
    state.portraitUrl = "";
  }
}

async function usePortraitFile(file) {
  if (state.captureInProgress) return;
  if (!file?.type.startsWith("image/")) {
    showToast("이미지 파일을 선택해 주세요.");
    return;
  }
  if (file.size > 24 * 1024 * 1024) {
    showToast("24MB 이하의 사진을 선택해 주세요.");
    return;
  }

  stopCamera();
  captureButton.disabled = true;
  revokePortraitUrl();
  state.portraitUrl = URL.createObjectURL(file);
  portraitSource.src = state.portraitUrl;

  try {
    await waitForImage(portraitSource);
    state.sourceType = "image";
    state.sourceWasCamera = false;
    state.cameraPausedAfterCapture = false;
    state.mirror = false;
    state.maskAvailable = false;
    state.personBounds = null;
    state.staticMaskRequested = false;
    cameraStage.classList.add("has-source");
    mirrorButton.disabled = false;
    mirrorButton.setAttribute("aria-pressed", "false");
    switchCameraButton.disabled = true;
    showCameraMessage("");
    updateAiStatus("loading", "사진에서 인물을 찾는 중");

    await loadSegmenter();
    if (state.segmenter) {
      runSegmentation(performance.now());
    } else {
      updateAiStatus("fallback", "소프트 인물 합성");
      updateCaptureReadiness();
    }
    showToast("사진을 불러왔어요. 배경과 무드를 골라보세요.");
    cameraStage.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch {
    showToast("사진을 불러오지 못했어요. 다른 파일을 선택해 주세요.");
  }
}

function revokeCustomBackgroundUrl() {
  if (state.customBackgroundUrl) {
    URL.revokeObjectURL(state.customBackgroundUrl);
    state.customBackgroundUrl = "";
  }
}

function selectBackgroundButton(selectedButton) {
  document.querySelectorAll(".background-option").forEach((button) => {
    const isSelected = button === selectedButton;
    button.classList.toggle("is-selected", isSelected);
    if (button.hasAttribute("data-tone")) {
      button.setAttribute("aria-pressed", String(isSelected));
    }
  });
}

async function useBackgroundFile(file) {
  if (state.captureInProgress) return;
  if (!file?.type.startsWith("image/")) {
    showToast("배경으로 사용할 이미지 파일을 선택해 주세요.");
    return;
  }
  if (file.size > 24 * 1024 * 1024) {
    showToast("24MB 이하의 배경 사진을 선택해 주세요.");
    return;
  }

  revokeCustomBackgroundUrl();
  state.customBackgroundUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = state.customBackgroundUrl;

  try {
    await waitForImage(image);
    state.customBackground = image;
    state.backgroundImage = image;
    state.backgroundTone = "custom";

    const uploadButton = byId("backgroundUploadButton");
    const thumb = uploadButton.querySelector(".background-thumb");
    thumb.replaceChildren();
    const thumbnailImage = document.createElement("img");
    thumbnailImage.src = state.customBackgroundUrl;
    thumbnailImage.alt = "";
    thumb.appendChild(thumbnailImage);
    const check = document.createElement("i");
    check.textContent = "✓";
    check.setAttribute("aria-hidden", "true");
    thumb.appendChild(check);
    uploadButton.querySelector("strong").textContent = "내 배경";
    uploadButton.querySelector("small").textContent = file.name;
    selectBackgroundButton(uploadButton);
    showToast("내 배경을 적용했어요.");
  } catch {
    showToast("배경 사진을 불러오지 못했어요.");
  }
}

function selectBuiltInBackground(button) {
  if (state.captureInProgress) return;
  state.backgroundImage = defaultBackground;
  state.backgroundTone = button.dataset.tone;
  selectBackgroundButton(button);
}

function selectLook(button) {
  if (state.captureInProgress) return;
  state.look = button.dataset.look;
  document.querySelectorAll(".look-option").forEach((option) => {
    const isSelected = option === button;
    option.classList.toggle("is-selected", isSelected);
    option.setAttribute("aria-pressed", String(isSelected));
  });
}

function bindRealismControls() {
  const personScale = byId("personScale");
  const personHeight = byId("personHeight");
  const shadowStrength = byId("shadowStrength");

  personScale.addEventListener("input", () => {
    state.personScale = Number(personScale.value) / 100;
    byId("personScaleValue").textContent = `${personScale.value}%`;
  });

  personHeight.addEventListener("input", () => {
    state.personOffsetY = Number(personHeight.value) / 100;
    const prefix = Number(personHeight.value) > 0 ? "+" : "";
    byId("personHeightValue").textContent = `${prefix}${personHeight.value}`;
  });

  shadowStrength.addEventListener("input", () => {
    state.shadowStrength = Number(shadowStrength.value) / 100;
    byId("shadowValue").textContent = `${shadowStrength.value}%`;
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function runCountdown(seconds) {
  cameraStage.classList.add("is-counting");
  for (let number = seconds; number > 0; number -= 1) {
    countdownElement.textContent = number;
    countdownElement.classList.remove("pop");
    void countdownElement.offsetWidth;
    countdownElement.classList.add("pop");
    await wait(1000);
  }
  countdownElement.textContent = "";
  countdownElement.classList.remove("pop");
  cameraStage.classList.remove("is-counting");
}

function setStudioControlsLocked(locked) {
  document
    .querySelectorAll(
      ".background-option, .look-option, .realism-tuning input, #timerSelect, #uploadShortcut, #mirrorButton, #switchCameraButton",
    )
    .forEach((control) => {
      control.disabled = locked;
    });
}

function segmentExactFrame(source) {
  if (!state.segmenter) return Promise.resolve(false);

  state.isSegmenting = true;
  const inferenceTime = Math.max(
    Math.round(performance.now()),
    state.maskUpdatedAt + 1,
  );

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      updateMask(result);
      resolve(Boolean(state.maskAvailable));
    };

    try {
      const maybeResult = state.segmenter.segmentForVideo(
        source,
        inferenceTime,
        finish,
      );
      if (maybeResult?.categoryMask || maybeResult?.confidenceMasks) {
        finish(maybeResult);
      }
      window.setTimeout(() => {
        if (!settled) {
          settled = true;
          state.isSegmenting = false;
          resolve(false);
        }
      }, 800);
    } catch (error) {
      console.warn("촬영 프레임의 인물 분리를 건너뜁니다.", error);
      state.isSegmenting = false;
      settled = true;
      resolve(false);
    }
  });
}

function canvasToBlob(canvas, type = "image/jpeg", quality = 0.94) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("사진 파일을 만들지 못했습니다."));
    }, type, quality);
  });
}

function setResultBlob(blob) {
  if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
  state.resultBlob = blob;
  state.resultUrl = URL.createObjectURL(blob);
  resultImage.src = state.resultUrl;
}

function setStep(step) {
  document.querySelectorAll(".step-indicator span").forEach((element, index) => {
    element.classList.toggle("is-active", index + 1 === step);
  });
}

async function takePhoto() {
  if (!getSource() || state.captureInProgress) return;

  state.captureInProgress = true;
  captureButton.disabled = true;
  setStudioControlsLocked(true);
  const timerSeconds = Number(byId("timerSelect").value);
  const sourceTypeAtStart = state.sourceType;
  const sourceTokenAtStart =
    state.sourceType === "video" ? state.stream : state.portraitUrl;

  try {
    if (timerSeconds > 0) await runCountdown(timerSeconds);
    const liveSource = getSource();
    const sourceIsUnchanged =
      sourceTypeAtStart === state.sourceType &&
      sourceTokenAtStart ===
        (state.sourceType === "video" ? state.stream : state.portraitUrl);
    if (!liveSource || !sourceIsUnchanged) {
      throw new Error("촬영 소스가 변경되었습니다.");
    }

    const captureSource =
      state.sourceType === "video"
        ? snapshotSource(liveSource, captureFrameCanvas, 1600)
        : liveSource;
    if (state.segmenter) {
      await segmentExactFrame(
        state.sourceType === "video"
          ? captureSource
          : snapshotSource(
              captureSource,
              state.imageInferenceCanvas,
              MAX_STILL_INFERENCE_EDGE,
            ),
      );
    }

    cameraStage.classList.add("is-captured");
    flashElement.classList.remove("is-active");
    void flashElement.offsetWidth;
    flashElement.classList.add("is-active");

    const exportContext = exportCanvas.getContext("2d", { alpha: false });
    renderComposite(
      exportContext,
      EXPORT_WIDTH,
      EXPORT_HEIGHT,
      captureSource,
    );
    const blob = await canvasToBlob(exportCanvas);
    setResultBlob(blob);
    setStep(3);
    await wait(240);

    if (state.sourceType === "video") {
      stopCamera();
      state.cameraPausedAfterCapture = true;
    }

    resultDialog.showModal();
  } catch (error) {
    console.error(error);
    showToast("사진을 완성하지 못했어요. 잠시 후 다시 촬영해 주세요.");
  } finally {
    state.captureInProgress = false;
    setStudioControlsLocked(false);
    cameraStage.classList.remove("is-captured");
    switchCameraButton.disabled = !state.stream;
    mirrorButton.disabled = !getSource();
    updateCaptureReadiness();
  }
}

function buildFilename() {
  const date = new Date();
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "-",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ].join("");
  return `오늘-파리-${stamp}.jpg`;
}

function downloadPhoto({ quiet = false } = {}) {
  if (!state.resultUrl) return;
  const link = document.createElement("a");
  link.href = state.resultUrl;
  link.download = buildFilename();
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (!quiet) showToast("사진을 기기에 저장했어요.");
}

async function sharePhoto() {
  if (!state.resultBlob) return;
  const file = new File([state.resultBlob], buildFilename(), {
    type: state.resultBlob.type || "image/jpeg",
  });
  const shareData = {
    title: "오늘, 파리",
    text: "파리에서 만든 나의 인생사진",
    files: [file],
  };

  if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
    try {
      await navigator.share(shareData);
      showToast("선택한 앱으로 공유했어요.");
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.warn("시스템 공유를 열지 못했습니다.", error);
    }
  }

  downloadPhoto({ quiet: true });
  showToast("이 브라우저에서는 사진 공유창을 열 수 없어 사진을 저장했어요.", 3800);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function openEmailApp() {
  const email = byId("emailInput").value.trim();
  if (!isValidEmail(email)) {
    byId("emailInput").focus();
    showToast("받는 분의 이메일 주소를 확인해 주세요.");
    return;
  }

  downloadPhoto({ quiet: true });
  showToast("사진을 저장했어요. 메일 작성 화면에서 첨부해 주세요.", 4000);
  const subject = encodeURIComponent("파리에서 만든 인생사진");
  const body = encodeURIComponent(
    "파리에서 만든 사진을 보내요.\n\n방금 저장된 ‘오늘-파리’ 사진 파일을 이 메일에 첨부해 주세요.",
  );
  window.setTimeout(() => {
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
  }, 250);
}

function openSmsApp() {
  const phone = byId("phoneInput").value.trim();
  const compactPhone = phone.replace(/[^\d+]/g, "");
  if (compactPhone.length < 8) {
    byId("phoneInput").focus();
    showToast("받는 분의 휴대폰 번호를 확인해 주세요.");
    return;
  }

  downloadPhoto({ quiet: true });
  showToast("사진을 저장했어요. 문자 작성 화면에서 첨부해 주세요.", 4000);
  const message = encodeURIComponent(
    "파리에서 만든 인생사진을 보내요. 방금 저장된 ‘오늘-파리’ 사진을 첨부해 주세요.",
  );
  const separator = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? "&" : "?";
  window.setTimeout(() => {
    window.location.href = `sms:${compactPhone}${separator}body=${message}`;
  }, 250);
}

async function prepareRetake() {
  if (resultDialog.open) resultDialog.close();
  setStep(1);

  if (state.sourceWasCamera) {
    await startCamera();
  } else {
    state.cameraPausedAfterCapture = false;
    updateCaptureReadiness();
  }

  cameraStage.scrollIntoView({ behavior: "smooth", block: "center" });
}

function bindControls() {
  bindRealismControls();
  [byId("heroCameraButton"), byId("stageCameraButton")].forEach((button) => {
    button.addEventListener("click", startCamera);
  });

  [
    byId("heroUploadButton"),
    byId("stageUploadButton"),
    byId("uploadShortcut"),
  ].forEach((button) => {
    button.addEventListener("click", () => portraitUpload.click());
  });

  portraitUpload.addEventListener("change", (event) => {
    const [file] = event.target.files;
    usePortraitFile(file);
    event.target.value = "";
  });

  byId("backgroundUploadButton").addEventListener("click", () => {
    backgroundUpload.click();
  });
  backgroundUpload.addEventListener("change", (event) => {
    const [file] = event.target.files;
    useBackgroundFile(file);
    event.target.value = "";
  });

  document.querySelectorAll(".background-option[data-tone]").forEach((button) => {
    button.addEventListener("click", () => selectBuiltInBackground(button));
  });

  document.querySelectorAll(".look-option").forEach((button) => {
    button.addEventListener("click", () => selectLook(button));
  });

  switchCameraButton.addEventListener("click", switchCamera);
  mirrorButton.addEventListener("click", toggleMirror);
  captureButton.addEventListener("click", takePhoto);
  byId("downloadButton").addEventListener("click", () => downloadPhoto());
  byId("shareButton").addEventListener("click", sharePhoto);
  byId("emailButton").addEventListener("click", openEmailApp);
  byId("smsButton").addEventListener("click", openSmsApp);
  byId("retakeButton").addEventListener("click", prepareRetake);
  byId("resultCloseButton").addEventListener("click", prepareRetake);

  resultDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    prepareRetake();
  });

  window.addEventListener("pagehide", () => {
    const shouldResetCamera =
      state.sourceType === "video" && !state.cameraPausedAfterCapture;
    stopCamera();
    if (shouldResetCamera) {
      state.sourceType = null;
      state.maskAvailable = false;
      state.personBounds = null;
      cameraStage.classList.remove("has-source");
      captureButton.disabled = true;
      updateAiStatus("fallback", "카메라 다시 연결 필요");
    }
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && !getSource()) {
      showToast("화면으로 돌아왔어요. 카메라를 다시 켜 주세요.");
    }
  });
  window.addEventListener("beforeunload", () => {
    stopCamera();
    window.cancelAnimationFrame(state.renderHandle);
    revokePortraitUrl();
    revokeCustomBackgroundUrl();
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    try {
      state.segmenter?.close?.();
    } catch {
      // Nothing else to clean up.
    }
  });
}

async function initialize() {
  bindControls();
  try {
    await waitForImage(defaultBackground);
  } catch {
    showToast("파리 배경을 불러오지 못했어요. 페이지를 새로고침해 주세요.");
  }
  renderComposite(previewContext, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  state.renderHandle = window.requestAnimationFrame(renderLoop);
}

initialize();
