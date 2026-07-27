const byId = (id) => document.getElementById(id);

const previewCanvas = byId("previewCanvas");
const previewContext = previewCanvas.getContext("2d", {
  alpha: false,
  desynchronized: true,
});
const cameraVideo = byId("cameraVideo");
const portraitSource = byId("portraitSource");
const cameraCard = byId("cameraCard");
const cameraStage = byId("cameraStage");
const aiStatus = byId("aiStatus");
const captureButton = byId("captureButton");
const switchCameraButton = byId("switchCameraButton");
const mirrorButton = byId("mirrorButton");
const countdownElement = byId("countdown");
const flashElement = byId("flash");
const cameraMessage = byId("cameraMessage");
const cameraSelect = byId("cameraSelect");
const refreshCamerasButton = byId("refreshCamerasButton");
const cameraDeviceStatus = byId("cameraDeviceStatus");
const exitCameraModeButton = byId("exitCameraModeButton");
const portraitUpload = byId("portraitUpload");
const backgroundUpload = byId("backgroundUpload");
const resultDialog = byId("resultDialog");
const resultImage = byId("resultImage");
const toast = byId("toast");
const framingFeedback = byId("framingFeedback");
const driveHeaderStatus = byId("driveHeaderStatus");
const driveHeaderText = byId("driveHeaderText");
const driveSaveCard = byId("driveSaveCard");
const driveSaveStatus = byId("driveSaveStatus");
const driveSaveDetail = byId("driveSaveDetail");
const driveRetryButton = byId("driveRetryButton");
const resultStyleEditor = byId("resultStyleEditor");
const styleEditStatus = byId("styleEditStatus");
const finalizeStyleButton = byId("finalizeStyleButton");

const DEFAULT_BACKGROUND_PATH = "/backgrounds/paris-eiffel-closeup.webp";
const DRIVE_UPLOAD_ENDPOINT = "/api/photos";
const MEDIAPIPE_VERSION = "0.10.35";
const MEDIAPIPE_MODULE =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
const MEDIAPIPE_WASM =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const SELFIE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
const PREVIEW_WIDTH = 720;
const PREVIEW_HEIGHT = 900;
const EXPORT_WIDTH = 1440;
const EXPORT_HEIGHT = 1800;
const SEGMENTATION_INTERVAL = 92;
const MAX_INFERENCE_EDGE = 640;
const MAX_STILL_INFERENCE_EDGE = 1600;
const MAX_CAPTURE_EDGE = 4096;
const REFERENCE_PERSON_HEIGHT = 0.44;
const REFERENCE_GROUND_Y = 0.975;
const REFERENCE_PERSON_CENTER_X = 0.52;

const defaultBackground = new Image();
defaultBackground.decoding = "async";
defaultBackground.src = DEFAULT_BACKGROUND_PATH;

const state = {
  backgroundImage: defaultBackground,
  backgroundPath: DEFAULT_BACKGROUND_PATH,
  customBackground: null,
  customBackgroundUrl: "",
  backgroundTone: "golden",
  look: "natural",
  lookBeforeCapture: null,
  hairStyle: "original",
  personScale: 0.9,
  personOffsetY: 0,
  shadowStrength: 0.55,
  sourceType: null,
  portraitUrl: "",
  stream: null,
  cameraDevices: [],
  selectedCameraId: "",
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
  segmentationGeneration: 0,
  lastSegmentedAt: 0,
  lastVideoTime: -1,
  maskCanvas: document.createElement("canvas"),
  segmentationFrameCanvas: document.createElement("canvas"),
  imageInferenceCanvas: document.createElement("canvas"),
  maskAvailable: false,
  maskUpdatedAt: 0,
  personBounds: null,
  personClipping: null,
  maskTemporalValues: null,
  maskTemporalWidth: 0,
  maskTemporalHeight: 0,
  maskTemporalSourceToken: null,
  staticMaskRequested: false,
  staticMaskAttempts: 0,
  resultBlob: null,
  resultUrl: "",
  resultFinalized: false,
  resultRevision: 0,
  resultRenderRevision: 0,
  resultRenderTimer: 0,
  resultRenderPromise: null,
  resultBackgroundRequest: 0,
  resultBackgroundPromise: null,
  captureRecipe: null,
  captureMethod: "video-frame",
  captureMaskQuality: "soft",
  renderHandle: 0,
  lastRenderedAt: 0,
  captureInProgress: false,
  sourceWasCamera: false,
  cameraPausedAfterCapture: false,
  cameraRequestId: 0,
  cameraModeActive: false,
  nativeFullscreenActive: false,
  cameraModeScrollY: 0,
  fullscreenExitInProgress: false,
  captureSequence: 0,
  toastTimer: 0,
  framingReady: false,
  framingReadySince: 0,
  driveUploadId: "",
  driveFilename: "",
  driveUploadPromise: null,
};

const personLayer = document.createElement("canvas");
const softMaskLayer = document.createElement("canvas");
const exportCanvas = document.createElement("canvas");
const captureFrameCanvas = document.createElement("canvas");
const fallbackFrameCanvas = document.createElement("canvas");
const sharpnessSampleCanvas = document.createElement("canvas");
const captureMaskCanvas = document.createElement("canvas");
const previewMaskBackupCanvas = document.createElement("canvas");
const hairSampleCanvas = document.createElement("canvas");
const hairBackLayer = document.createElement("canvas");
const hairFrontLayer = document.createElement("canvas");
const faceDetailCanvas = document.createElement("canvas");
const faceBlurCanvas = document.createElement("canvas");
const monochromeLayer = document.createElement("canvas");
const environmentSampleCanvas = document.createElement("canvas");
const backgroundImageCache = new Map([[DEFAULT_BACKGROUND_PATH, defaultBackground]]);
const backgroundEnvironmentCache = new WeakMap();
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
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
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
  const filter = filters[state.backgroundTone] || filters.golden;
  return state.look === "monochrome"
    ? `${filter} grayscale(1) contrast(1.04)`
    : filter;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothStep(minimum, maximum, value) {
  const normalized = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function getPortraitFilter(environment) {
  const presets = {
    crisp: {
      brightness: 1.018,
      saturation: 0.97,
      contrast: 1.045,
      sepia: 0,
      grayscale: 0,
    },
    natural: {
      brightness: 1.015,
      saturation: 0.94,
      contrast: 0.98,
      sepia: 0,
      grayscale: 0,
    },
    "paris-film": {
      brightness: 0.995,
      saturation: 0.82,
      contrast: 0.95,
      sepia: 0.08,
      grayscale: 0,
    },
    lumiere: {
      brightness: 1.055,
      saturation: 1,
      contrast: 0.95,
      sepia: 0.05,
      grayscale: 0,
    },
    monochrome: {
      brightness: 1.02,
      saturation: 0,
      contrast: 1.07,
      sepia: 0,
      grayscale: 1,
    },
  };
  const preset = presets[state.look] || presets.natural;
  const environmentLuminance = environment?.luminance ?? 0.58;
  const exposureMatch = clamp(0.87 + environmentLuminance * 0.27, 0.91, 1.08);
  const brightness = (preset.brightness * exposureMatch).toFixed(3);
  const saturation = (
    preset.saturation *
    clamp(0.94 + environmentLuminance * 0.08, 0.92, 1.02)
  ).toFixed(3);

  return [
    `brightness(${brightness})`,
    `saturate(${saturation})`,
    `sepia(${preset.sepia})`,
    `grayscale(${preset.grayscale})`,
    `contrast(${preset.contrast})`,
  ].join(" ");
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

function getFallbackEnvironment() {
  const environments = {
    golden: { red: 210, green: 186, blue: 151, luminance: 0.68 },
    rose: { red: 205, green: 177, blue: 170, luminance: 0.65 },
    film: { red: 135, green: 145, blue: 150, luminance: 0.48 },
    custom: { red: 178, green: 177, blue: 170, luminance: 0.58 },
  };
  return environments[state.backgroundTone] || environments.custom;
}

function sampleBackgroundEnvironment(context, width, height) {
  const image = state.backgroundImage;
  const cachedByTone = image && backgroundEnvironmentCache.get(image);
  if (cachedByTone?.has(state.backgroundTone)) {
    return cachedByTone.get(state.backgroundTone);
  }

  let environment = getFallbackEnvironment();
  try {
    environmentSampleCanvas.width = 5;
    environmentSampleCanvas.height = 7;
    const sampleContext = environmentSampleCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    sampleContext.clearRect(0, 0, 5, 7);
    sampleContext.drawImage(context.canvas, 0, 0, width, height, 0, 0, 5, 7);
    const pixels = sampleContext.getImageData(0, 0, 5, 7).data;
    let red = 0;
    let green = 0;
    let blue = 0;
    let weightTotal = 0;

    for (let y = 1; y < 7; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const pixelIndex = (y * 5 + x) * 4;
        const centerWeight = x === 2 ? 1.35 : 1;
        const groundWeight = y >= 4 ? 1.2 : 1;
        const weight = centerWeight * groundWeight;
        red += pixels[pixelIndex] * weight;
        green += pixels[pixelIndex + 1] * weight;
        blue += pixels[pixelIndex + 2] * weight;
        weightTotal += weight;
      }
    }

    red /= weightTotal;
    green /= weightTotal;
    blue /= weightTotal;
    environment = {
      red: Math.round(red),
      green: Math.round(green),
      blue: Math.round(blue),
      luminance: clamp(
        (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255,
        0.12,
        0.92,
      ),
    };
  } catch {
    // A custom cross-origin image can taint a canvas; the tone preset is safe.
  }

  if (image) {
    const toneCache = cachedByTone || new Map();
    toneCache.set(state.backgroundTone, environment);
    backgroundEnvironmentCache.set(image, toneCache);
  }
  return environment;
}

function ensureLayerSize(layer, width, height) {
  if (layer.width !== width || layer.height !== height) {
    layer.width = width;
    layer.height = height;
  }
}

function getLayerPersonBounds(
  sourceCrop,
  sourceSize,
  width,
  height,
  personBounds = state.personBounds,
  mirror = state.mirror,
) {
  if (!personBounds) return null;

  let left =
    ((personBounds.left * sourceSize.width - sourceCrop.x) /
      sourceCrop.width) *
    width;
  let right =
    ((personBounds.right * sourceSize.width - sourceCrop.x) /
      sourceCrop.width) *
    width;
  const top =
    ((personBounds.top * sourceSize.height - sourceCrop.y) /
      sourceCrop.height) *
    height;
  const bottom =
    ((personBounds.bottom * sourceSize.height - sourceCrop.y) /
      sourceCrop.height) *
    height;

  if (mirror) {
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
  if (personBounds) {
    const requestedHeight =
      height * REFERENCE_PERSON_HEIGHT * (state.personScale / 0.9);
    const scale = clamp(requestedHeight / personBounds.height, 0.32, 1.72);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    const groundY =
      height * REFERENCE_GROUND_Y + height * state.personOffsetY;
    return {
      x: width * REFERENCE_PERSON_CENTER_X - personBounds.centerX * scale,
      y: groundY - personBounds.bottom * scale,
      width: drawWidth,
      height: drawHeight,
      scale,
      groundX: width * REFERENCE_PERSON_CENTER_X,
      groundY,
      subjectWidth: personBounds.width * scale,
      subjectHeight: personBounds.height * scale,
    };
  }

  const scale = state.personScale;
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  return {
    x: (width - drawWidth) / 2,
    y: height - drawHeight + height * state.personOffsetY,
    width: drawWidth,
    height: drawHeight,
    scale,
    groundX: width / 2,
    groundY: height * 0.91 + height * state.personOffsetY,
    subjectWidth: width * 0.46 * scale,
    subjectHeight: height * 0.7 * scale,
  };
}

function setFramingFeedback(mode, message) {
  if (!framingFeedback) return;
  if (
    framingFeedback.dataset.feedbackMode === mode &&
    framingFeedback.dataset.feedbackMessage === message
  ) {
    return;
  }
  framingFeedback.dataset.feedbackMode = mode;
  framingFeedback.dataset.feedbackMessage = message;
  framingFeedback.classList.toggle("is-ready", mode === "ready");
  framingFeedback.classList.toggle("is-warning", mode === "warning");
  const label = framingFeedback.querySelector("span");
  if (label) label.textContent = message;
}

function updateFramingGuidance() {
  if (!getSource() || !state.personBounds) {
    state.framingReady = false;
    state.framingReadySince = 0;
    setFramingFeedback(
      "waiting",
      "약 1.5m에서 시작해 머리와 발이 보일 때까지 뒤로 이동해 주세요",
    );
    return;
  }

  const source = getSource();
  const sourceSize = getSourceSize(source);
  const sourceCrop = getCoverCrop(
    sourceSize.width,
    sourceSize.height,
    PREVIEW_WIDTH,
    PREVIEW_HEIGHT,
  );
  const personBounds = getLayerPersonBounds(
    sourceCrop,
    sourceSize,
    PREVIEW_WIDTH,
    PREVIEW_HEIGHT,
  );

  if (!personBounds) {
    state.framingReady = false;
    setFramingFeedback(
      "waiting",
      "약 1.5m에서 시작해 머리와 발이 모두 보이게 맞춰주세요",
    );
    return;
  }

  const sourceHeight = personBounds.height / PREVIEW_HEIGHT;
  const visualCenterX = personBounds.centerX / PREVIEW_WIDTH;
  const sourceClipped =
    Boolean(
      state.personClipping?.top ||
      state.personClipping?.bottom ||
      state.personClipping?.left ||
      state.personClipping?.right,
    ) ||
    personBounds.top <= 2 ||
    personBounds.bottom >= PREVIEW_HEIGHT - 2 ||
    personBounds.left <= 2 ||
    personBounds.right >= PREVIEW_WIDTH - 2 ||
    state.personBounds.top <= 0.018 ||
    state.personBounds.bottom >= 0.985 ||
    state.personBounds.left <= 0.018 ||
    state.personBounds.right >= 0.982;

  let mode = "warning";
  let message = "";
  if (sourceClipped || sourceHeight > 0.92) {
    message = "반걸음 뒤로 이동해 머리와 발끝을 모두 보여주세요";
  } else if (sourceHeight < 0.52) {
    message = "반걸음 앞으로 이동하면 인물이 더 선명하게 촬영돼요";
  } else if (visualCenterX < 0.42) {
    message = "화면 오른쪽으로 조금 이동해 중앙선에 맞춰주세요";
  } else if (visualCenterX > 0.58) {
    message = "화면 왼쪽으로 조금 이동해 중앙선에 맞춰주세요";
  } else {
    const now = performance.now();
    if (!state.framingReadySince) state.framingReadySince = now;
    const stable = now - state.framingReadySince >= 900;
    state.framingReady = stable;
    mode = stable ? "ready" : "waiting";
    message = stable
      ? "좋아요 — 그 자리에서 정면을 보고 촬영하세요"
      : "구도가 맞았어요 — 잠시 그대로 서주세요";
    setFramingFeedback(mode, message);
    return;
  }

  state.framingReady = false;
  state.framingReadySince = 0;
  setFramingFeedback(mode, message);
}

function drawGroundingShadow(context, width, height, placement, environment) {
  if (state.shadowStrength <= 0) return;
  const luminance = environment?.luminance ?? 0.58;
  const red = Math.round((environment?.red ?? 120) * 0.2);
  const green = Math.round((environment?.green ?? 110) * 0.18);
  const blue = Math.round((environment?.blue ?? 100) * 0.16);
  const baseOpacity =
    clamp(0.2 + (1 - luminance) * 0.22, 0.2, 0.38) *
    state.shadowStrength;
  const ambientRadius = Math.max(
    width * 0.035,
    placement.subjectWidth * 0.54,
  );

  context.save();
  context.translate(placement.groundX, placement.groundY);
  context.scale(1, 0.22);
  const ambientShadow = context.createRadialGradient(
    0,
    0,
    ambientRadius * 0.08,
    0,
    0,
    ambientRadius,
  );
  ambientShadow.addColorStop(
    0,
    `rgba(${red}, ${green}, ${blue}, ${baseOpacity})`,
  );
  ambientShadow.addColorStop(
    0.46,
    `rgba(${red}, ${green}, ${blue}, ${baseOpacity * 0.46})`,
  );
  ambientShadow.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
  context.fillStyle = ambientShadow;
  context.beginPath();
  context.ellipse(0, 0, ambientRadius, height * 0.07, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  const contactRadius = Math.max(
    width * 0.016,
    placement.subjectWidth * 0.2,
  );
  context.save();
  context.translate(placement.groundX, placement.groundY - height * 0.001);
  context.scale(1, 0.18);
  const contactShadow = context.createRadialGradient(
    0,
    0,
    0,
    0,
    0,
    contactRadius,
  );
  contactShadow.addColorStop(
    0,
    `rgba(${red}, ${green}, ${blue}, ${clamp(baseOpacity * 1.28, 0, 0.48)})`,
  );
  contactShadow.addColorStop(
    0.62,
    `rgba(${red}, ${green}, ${blue}, ${baseOpacity * 0.42})`,
  );
  contactShadow.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
  context.fillStyle = contactShadow;
  context.beginPath();
  context.ellipse(0, 0, contactRadius, height * 0.028, 0, 0, Math.PI * 2);
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

function applyPortraitMask(
  context,
  sourceCrop,
  sourceSize,
  width,
  height,
  useAiMask,
  maskCanvas = state.maskCanvas,
  mirror = state.mirror,
) {
  context.globalCompositeOperation = "destination-in";

  if (useAiMask) {
    const maskCrop = {
      x: (sourceCrop.x / sourceSize.width) * maskCanvas.width,
      y: (sourceCrop.y / sourceSize.height) * maskCanvas.height,
      width: (sourceCrop.width / sourceSize.width) * maskCanvas.width,
      height: (sourceCrop.height / sourceSize.height) * maskCanvas.height,
    };
    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    drawCropped(context, maskCanvas, maskCrop, width, height, {
      mirror,
      filter: `blur(${clamp(width * 0.00072, 0.42, 1.05)}px)`,
    });
    context.restore();
    return;
  }

  ensureLayerSize(softMaskLayer, width, height);
  drawSoftPortraitMask(softMaskLayer.getContext("2d"), width, height);
  context.drawImage(softMaskLayer, 0, 0, width, height);
}

function drawColorHarmony(context, width, height, hasPortrait) {
  if (hasPortrait && state.look !== "monochrome") {
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
  } else if (state.look === "monochrome") {
    context.globalCompositeOperation = "soft-light";
    context.globalAlpha = 0.08;
    context.fillStyle = "#e6e6e2";
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

function applyMonochromeFinish(context, width, height) {
  if (state.look !== "monochrome") return;
  ensureLayerSize(monochromeLayer, width, height);
  const finishContext = monochromeLayer.getContext("2d");
  finishContext.clearRect(0, 0, width, height);
  finishContext.save();
  finishContext.filter = "grayscale(1) contrast(1.04)";
  finishContext.drawImage(context.canvas, 0, 0, width, height);
  finishContext.restore();
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.filter = "none";
  context.clearRect(0, 0, width, height);
  context.drawImage(monochromeLayer, 0, 0);
  context.restore();
}

function getPlacedSubjectBounds(layerBounds, placement) {
  if (!layerBounds) return null;
  const left = placement.x + layerBounds.left * placement.scale;
  const right = placement.x + layerBounds.right * placement.scale;
  const top = placement.y + layerBounds.top * placement.scale;
  const bottom = placement.y + layerBounds.bottom * placement.scale;
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

function mixRgb(first, second, amount) {
  const inverse = 1 - amount;
  return {
    red: Math.round(first.red * inverse + second.red * amount),
    green: Math.round(first.green * inverse + second.green * amount),
    blue: Math.round(first.blue * inverse + second.blue * amount),
  };
}

function rgbString(color, alpha = 1) {
  return `rgba(${color.red}, ${color.green}, ${color.blue}, ${alpha})`;
}

function sampleHairColor(layer, personBounds, recipe) {
  if (recipe?.hairColor) return recipe.hairColor;
  const fallback = { red: 48, green: 37, blue: 33 };
  if (!personBounds || personBounds.width < 12 || personBounds.height < 30) {
    return fallback;
  }

  const sampleWidth = clamp(personBounds.width * 0.62, 18, layer.width);
  const sampleHeight = clamp(personBounds.height * 0.17, 14, layer.height);
  const sampleX = clamp(
    personBounds.centerX - sampleWidth / 2,
    0,
    Math.max(0, layer.width - sampleWidth),
  );
  const sampleY = clamp(
    personBounds.top,
    0,
    Math.max(0, layer.height - sampleHeight),
  );

  try {
    hairSampleCanvas.width = 24;
    hairSampleCanvas.height = 18;
    const sampleContext = hairSampleCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    sampleContext.clearRect(0, 0, 24, 18);
    sampleContext.drawImage(
      layer,
      sampleX,
      sampleY,
      sampleWidth,
      sampleHeight,
      0,
      0,
      24,
      18,
    );
    const pixels = sampleContext.getImageData(0, 0, 24, 18).data;
    const candidates = [];
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] < 190) continue;
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
      if (luminance > 178) continue;
      candidates.push({ red, green, blue, luminance });
    }
    if (candidates.length < 14) return fallback;
    candidates.sort((first, second) => first.luminance - second.luminance);
    const trimmed = candidates.slice(
      Math.floor(candidates.length * 0.12),
      Math.max(1, Math.ceil(candidates.length * 0.68)),
    );
    const channelMedian = (channel) => {
      const values = trimmed.map((pixel) => pixel[channel]).sort((a, b) => a - b);
      return values[Math.floor(values.length / 2)];
    };
    const sampled = {
      red: channelMedian("red"),
      green: channelMedian("green"),
      blue: channelMedian("blue"),
    };
    if (recipe) recipe.hairColor = sampled;
    return sampled;
  } catch {
    return fallback;
  }
}

function getHairGeometry(subjectBounds) {
  if (!subjectBounds || subjectBounds.height < 70 || subjectBounds.width < 24) {
    return null;
  }
  const headHeight = subjectBounds.height * 0.145;
  const headWidth = clamp(
    subjectBounds.height * 0.095,
    subjectBounds.width * 0.16,
    subjectBounds.width * 0.42,
  );
  if (headWidth < 24 || headHeight < 34) return null;
  return {
    centerX: subjectBounds.centerX,
    top: subjectBounds.top,
    width: headWidth,
    height: headHeight,
    faceCenterY: subjectBounds.top + subjectBounds.height * 0.085,
    faceRadiusX: headWidth * 0.38,
    faceRadiusY: headHeight * 0.43,
  };
}

function drawHairBack(context, width, height, geometry, palette, style) {
  ensureLayerSize(hairBackLayer, width, height);
  const hairContext = hairBackLayer.getContext("2d");
  hairContext.clearRect(0, 0, width, height);
  hairContext.save();
  hairContext.globalAlpha = 0.9;
  const { centerX: x, top: y, width: w, height: h } = geometry;
  const gradient = hairContext.createLinearGradient(
    x - w * 0.7,
    y,
    x + w * 0.7,
    y + h * 1.8,
  );
  gradient.addColorStop(0, rgbString(palette.highlight));
  gradient.addColorStop(0.34, rgbString(palette.base));
  gradient.addColorStop(1, rgbString(palette.shadow));
  hairContext.fillStyle = gradient;
  hairContext.strokeStyle = rgbString(palette.shadow, 0.62);
  hairContext.lineWidth = Math.max(1.2, w * 0.025);
  hairContext.lineJoin = "round";

  if (style === "soft-wave") {
    hairContext.beginPath();
    hairContext.moveTo(x - w * 0.48, y + h * 0.36);
    hairContext.bezierCurveTo(
      x - w * 0.82,
      y + h * 0.72,
      x - w * 0.5,
      y + h * 1.2,
      x - w * 0.72,
      y + h * 1.62,
    );
    hairContext.bezierCurveTo(
      x - w * 0.91,
      y + h * 1.96,
      x - w * 0.45,
      y + h * 2.12,
      x - w * 0.27,
      y + h * 1.67,
    );
    hairContext.lineTo(x - w * 0.08, y + h * 0.65);
    hairContext.closePath();
    hairContext.fill();
    hairContext.stroke();

    hairContext.beginPath();
    hairContext.moveTo(x + w * 0.48, y + h * 0.36);
    hairContext.bezierCurveTo(
      x + w * 0.82,
      y + h * 0.72,
      x + w * 0.5,
      y + h * 1.2,
      x + w * 0.72,
      y + h * 1.62,
    );
    hairContext.bezierCurveTo(
      x + w * 0.91,
      y + h * 1.96,
      x + w * 0.45,
      y + h * 2.12,
      x + w * 0.27,
      y + h * 1.67,
    );
    hairContext.lineTo(x + w * 0.08, y + h * 0.65);
    hairContext.closePath();
    hairContext.fill();
    hairContext.stroke();
  } else if (style === "high-bun") {
    hairContext.beginPath();
    hairContext.ellipse(
      x,
      y - h * 0.15,
      w * 0.39,
      h * 0.31,
      -0.08,
      0,
      Math.PI * 2,
    );
    hairContext.fill();
    hairContext.stroke();
  } else if (style === "short-bob") {
    hairContext.beginPath();
    hairContext.moveTo(x, y - h * 0.02);
    hairContext.bezierCurveTo(
      x - w * 0.86,
      y + h * 0.03,
      x - w * 0.79,
      y + h * 1.35,
      x - w * 0.5,
      y + h * 1.62,
    );
    hairContext.bezierCurveTo(
      x - w * 0.14,
      y + h * 1.83,
      x + w * 0.14,
      y + h * 1.83,
      x + w * 0.5,
      y + h * 1.62,
    );
    hairContext.bezierCurveTo(
      x + w * 0.79,
      y + h * 1.35,
      x + w * 0.86,
      y + h * 0.03,
      x,
      y - h * 0.02,
    );
    hairContext.closePath();
    hairContext.fill();
    hairContext.stroke();
  }

  hairContext.restore();
  context.save();
  context.filter = `blur(${clamp(w * 0.006, 0.35, 1.1)}px)`;
  context.drawImage(hairBackLayer, 0, 0);
  context.restore();
}

function drawHairFront(context, width, height, geometry, palette, style) {
  ensureLayerSize(hairFrontLayer, width, height);
  const hairContext = hairFrontLayer.getContext("2d");
  hairContext.clearRect(0, 0, width, height);
  hairContext.save();
  const { centerX: x, top: y, width: w, height: h } = geometry;
  hairContext.strokeStyle = rgbString(palette.base, 0.88);
  hairContext.lineCap = "round";
  hairContext.lineJoin = "round";

  const drawTemple = (side, length = 1.28) => {
    hairContext.lineWidth = Math.max(3, w * 0.13);
    hairContext.beginPath();
    hairContext.moveTo(x + side * w * 0.34, y + h * 0.32);
    hairContext.bezierCurveTo(
      x + side * w * 0.56,
      y + h * 0.65,
      x + side * w * 0.46,
      y + h * 0.94,
      x + side * w * 0.54,
      y + h * length,
    );
    hairContext.stroke();
  };

  if (style === "soft-wave") {
    drawTemple(-1, 1.55);
    drawTemple(1, 1.55);
  } else if (style === "high-bun") {
    drawTemple(-1, 1.03);
    drawTemple(1, 1.03);
    hairContext.lineWidth = Math.max(2, w * 0.08);
    hairContext.beginPath();
    hairContext.arc(x, y + h * 0.48, w * 0.44, Math.PI * 1.12, Math.PI * 1.88);
    hairContext.stroke();
  } else if (style === "short-bob") {
    drawTemple(-1, 1.44);
    drawTemple(1, 1.44);
  }

  hairContext.globalCompositeOperation = "destination-out";
  hairContext.beginPath();
  hairContext.ellipse(
    x,
    geometry.faceCenterY,
    geometry.faceRadiusX * 1.12,
    geometry.faceRadiusY * 1.12,
    0,
    0,
    Math.PI * 2,
  );
  hairContext.fill();
  hairContext.restore();

  context.save();
  context.filter = `blur(${clamp(w * 0.004, 0.25, 0.75)}px)`;
  context.drawImage(hairFrontLayer, 0, 0);
  context.restore();
}

function drawHairMood(
  context,
  width,
  height,
  personBounds,
  placement,
  sampledHair,
  environment,
  layer,
) {
  const style = state.hairStyle;
  if (style === "original") return;
  const subjectBounds = getPlacedSubjectBounds(personBounds, placement);
  const geometry = getHairGeometry(subjectBounds);
  if (!geometry) return;

  const environmentColor = {
    red: environment.red,
    green: environment.green,
    blue: environment.blue,
  };
  const base = mixRgb(sampledHair, environmentColor, 0.08);
  const palette = {
    base,
    shadow: mixRgb(base, { red: 23, green: 19, blue: 17 }, 0.34),
    highlight: mixRgb(base, { red: 255, green: 233, blue: 207 }, 0.16),
  };

  if (layer === "back") {
    drawHairBack(context, width, height, geometry, palette, style);
  } else {
    drawHairFront(context, width, height, geometry, palette, style);
  }
}

function sharpenCapturedFace(context, subjectBounds) {
  if (!subjectBounds || subjectBounds.height < 180 || context.canvas.width < 900) {
    return;
  }
  const geometry = getHairGeometry(subjectBounds);
  if (!geometry) return;
  const regionWidth = Math.round(clamp(geometry.width * 1.02, 42, 360));
  const regionHeight = Math.round(clamp(geometry.height * 1.05, 52, 420));
  const sourceX = Math.round(
    clamp(
      geometry.centerX - regionWidth / 2,
      0,
      Math.max(0, context.canvas.width - regionWidth),
    ),
  );
  const sourceY = Math.round(
    clamp(
      geometry.top + geometry.height * 0.12,
      0,
      Math.max(0, context.canvas.height - regionHeight),
    ),
  );
  const width = Math.min(regionWidth, context.canvas.width - sourceX);
  const height = Math.min(regionHeight, context.canvas.height - sourceY);
  if (width < 32 || height < 40) return;

  try {
    ensureLayerSize(faceDetailCanvas, width, height);
    ensureLayerSize(faceBlurCanvas, width, height);
    const detailContext = faceDetailCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    const blurContext = faceBlurCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    detailContext.clearRect(0, 0, width, height);
    blurContext.clearRect(0, 0, width, height);
    detailContext.drawImage(
      context.canvas,
      sourceX,
      sourceY,
      width,
      height,
      0,
      0,
      width,
      height,
    );
    blurContext.save();
    blurContext.filter = `blur(${context.canvas.width >= 1400 ? 1.25 : 0.85}px)`;
    blurContext.drawImage(faceDetailCanvas, 0, 0);
    blurContext.restore();

    const original = detailContext.getImageData(0, 0, width, height);
    const blurred = blurContext.getImageData(0, 0, width, height);
    const amount = state.look === "crisp" ? 0.48 : 0.3;
    for (let index = 0; index < original.data.length; index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const sharpened =
          original.data[index + channel] +
          (original.data[index + channel] - blurred.data[index + channel]) *
            amount;
        original.data[index + channel] = clamp(Math.round(sharpened), 0, 255);
      }
    }
    detailContext.putImageData(original, 0, 0);
    context.save();
    context.beginPath();
    context.ellipse(
      geometry.centerX,
      sourceY + height * 0.52,
      width * 0.43,
      height * 0.47,
      0,
      0,
      Math.PI * 2,
    );
    context.clip();
    context.globalAlpha = 0.86;
    context.drawImage(faceDetailCanvas, sourceX, sourceY);
    context.restore();
  } catch (error) {
    console.info("얼굴 디테일 보정은 원본 선명도로 유지합니다.", error);
  }
}

function renderComposite(
  context,
  width,
  height,
  sourceOverride = null,
  captureRecipe = null,
) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.filter = "none";
  context.clearRect(0, 0, width, height);
  drawBackground(context, width, height);
  const environment = sampleBackgroundEnvironment(context, width, height);

  const source = sourceOverride || getSource();
  if (!source) {
    drawColorHarmony(context, width, height, false);
    context.restore();
    return;
  }

  const activeMask = captureRecipe?.maskCanvas || state.maskCanvas;
  const activePersonBounds =
    captureRecipe?.personBounds || state.personBounds;
  const activeMirror = captureRecipe?.mirror ?? state.mirror;
  const sourceSize = getSourceSize(source);
  const sourceCrop = getCoverCrop(sourceSize.width, sourceSize.height, width, height);
  const layerPersonBounds = getLayerPersonBounds(
    sourceCrop,
    sourceSize,
    width,
    height,
    activePersonBounds,
    activeMirror,
  );
  const placement = getPersonPlacement(width, height, layerPersonBounds);
  const useAiMask =
    (captureRecipe ? captureRecipe.maskAvailable : state.maskAvailable) &&
    activeMask.width > 0 &&
    activeMask.height > 0 &&
    (Boolean(captureRecipe) ||
      state.sourceType === "image" ||
      performance.now() - state.maskUpdatedAt < 1600);

  ensureLayerSize(personLayer, width, height);
  const personContext = personLayer.getContext("2d");
  personContext.setTransform(1, 0, 0, 1, 0, 0);
  personContext.clearRect(0, 0, width, height);
  personContext.globalCompositeOperation = "source-over";
  personContext.globalAlpha = 1;
  personContext.imageSmoothingEnabled = true;
  personContext.imageSmoothingQuality = "high";

  drawCropped(personContext, source, sourceCrop, width, height, {
    mirror: activeMirror,
    filter: getPortraitFilter(environment),
  });
  applyPortraitMask(
    personContext,
    sourceCrop,
    sourceSize,
    width,
    height,
    useAiMask,
    activeMask,
    activeMirror,
  );

  const sampledHair =
    state.hairStyle === "original"
      ? null
      : sampleHairColor(
          personLayer,
          layerPersonBounds,
          captureRecipe,
        );

  personContext.globalCompositeOperation = "source-atop";
  personContext.globalAlpha = state.look === "lumiere" ? 0.115 : 0.085;
  personContext.fillStyle =
    `rgb(${environment.red}, ${environment.green}, ${environment.blue})`;
  personContext.fillRect(0, 0, width, height);

  personContext.globalAlpha = 1;
  const directionalLight = personContext.createLinearGradient(0, 0, width, 0);
  const lightWarmth = clamp(
    (environment.red - environment.blue) / 255,
    -0.18,
    0.28,
  );
  directionalLight.addColorStop(
    0,
    `rgba(255, 231, 191, ${0.075 + Math.max(0, lightWarmth) * 0.23})`,
  );
  directionalLight.addColorStop(0.38, "rgba(255, 246, 225, .025)");
  directionalLight.addColorStop(0.7, "rgba(83, 108, 116, 0)");
  directionalLight.addColorStop(
    1,
    `rgba(54, 73, 80, ${clamp(0.035 + (0.58 - environment.luminance) * 0.08, 0.02, 0.08)})`,
  );
  personContext.fillStyle = directionalLight;
  personContext.fillRect(0, 0, width, height);

  personContext.globalCompositeOperation = "source-over";
  personContext.filter = "none";

  drawGroundingShadow(context, width, height, placement, environment);
  drawHairMood(
    context,
    width,
    height,
    layerPersonBounds,
    placement,
    sampledHair,
    environment,
    "back",
  );

  context.save();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = `drop-shadow(0 ${height * 0.0025}px ${width * 0.0035}px rgba(50, 38, 27, .065))`;
  context.drawImage(
    personLayer,
    placement.x,
    placement.y,
    placement.width,
    placement.height,
  );
  context.restore();

  drawHairMood(
    context,
    width,
    height,
    layerPersonBounds,
    placement,
    sampledHair,
    environment,
    "front",
  );
  if (captureRecipe) {
    sharpenCapturedFace(
      context,
      getPlacedSubjectBounds(layerPersonBounds, placement),
    );
  }

  drawColorHarmony(context, width, height, true);
  drawFilmGrain(context, width, height);
  applyMonochromeFinish(context, width, height);
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

function resetTemporalMask() {
  state.maskTemporalValues = null;
  state.maskTemporalWidth = 0;
  state.maskTemporalHeight = 0;
  state.maskTemporalSourceToken = null;
  state.personClipping = null;
}

function getMaskSourceToken() {
  return state.sourceType === "video" ? state.stream : state.portraitUrl;
}

function handlePersonMaskMiss() {
  state.maskAvailable = false;
  state.personBounds = null;
  state.personClipping = null;

  if (state.sourceType === "image") {
    if (state.staticMaskAttempts < 3) {
      state.staticMaskRequested = false;
      updateAiStatus("loading", "사진 속 인물을 다시 확인하는 중");
    } else {
      updateAiStatus("fallback", "사진 속 인물을 찾지 못했어요");
      showCameraMessage(
        "머리부터 발끝까지 선명하게 보이는 사진을 다시 불러와 주세요.",
      );
    }
  } else {
    updateAiStatus("loading", "사람을 화면 중앙에서 찾는 중");
  }

  updateCaptureReadiness();
  updateFramingGuidance();
}

function findQuantileIndex(values, total, quantile) {
  const target = total * quantile;
  let cumulative = 0;
  for (let index = 0; index < values.length; index += 1) {
    cumulative += values[index];
    if (cumulative >= target) return index;
  }
  return values.length - 1;
}

function findPrimaryPersonRegion(alphaValues, width, height) {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const componentThreshold = 0.16;
  const minimumArea = Math.max(24, Math.round(pixelCount * 0.0008));
  let bestComponent = null;

  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] || alphaValues[start] < componentThreshold) continue;

    let head = 0;
    let tail = 0;
    let mass = 0;
    let weightedX = 0;
    queue[tail] = start;
    tail += 1;
    visited[start] = 1;

    while (head < tail) {
      const index = queue[head];
      head += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      const alpha = alphaValues[index];
      const weight = alpha * alpha;
      mass += weight;
      weightedX += x * weight;

      const left = index - 1;
      const right = index + 1;
      const up = index - width;
      const down = index + width;

      if (x > 0 && !visited[left] && alphaValues[left] >= componentThreshold) {
        visited[left] = 1;
        queue[tail] = left;
        tail += 1;
      }
      if (
        x + 1 < width &&
        !visited[right] &&
        alphaValues[right] >= componentThreshold
      ) {
        visited[right] = 1;
        queue[tail] = right;
        tail += 1;
      }
      if (y > 0 && !visited[up] && alphaValues[up] >= componentThreshold) {
        visited[up] = 1;
        queue[tail] = up;
        tail += 1;
      }
      if (
        y + 1 < height &&
        !visited[down] &&
        alphaValues[down] >= componentThreshold
      ) {
        visited[down] = 1;
        queue[tail] = down;
        tail += 1;
      }
    }

    if (tail < minimumArea || mass <= 0) continue;
    const centerX = weightedX / mass / width;
    const centrality = 1.16 - Math.abs(centerX - 0.5) * 0.42;
    const score = mass * centrality;
    if (!bestComponent || score > bestComponent.score) {
      bestComponent = {
        score,
        indices: queue.slice(0, tail),
      };
    }
  }

  if (!bestComponent) return null;

  const columnMass = new Float32Array(width);
  const rowMass = new Float32Array(height);
  let totalMass = 0;
  let topEdgeCount = 0;
  let bottomEdgeCount = 0;
  let leftEdgeCount = 0;
  let rightEdgeCount = 0;
  let componentMinX = width;
  let componentMinY = height;
  let componentMaxX = -1;
  let componentMaxY = -1;
  const edgeRows = Math.max(1, Math.round(height * 0.012));
  const edgeColumns = Math.max(1, Math.round(width * 0.012));

  for (const index of bestComponent.indices) {
    const x = index % width;
    const y = Math.floor(index / width);
    const mass = Math.pow(alphaValues[index], 1.35);
    columnMass[x] += mass;
    rowMass[y] += mass;
    totalMass += mass;
    componentMinX = Math.min(componentMinX, x);
    componentMinY = Math.min(componentMinY, y);
    componentMaxX = Math.max(componentMaxX, x);
    componentMaxY = Math.max(componentMaxY, y);
    if (y < edgeRows) topEdgeCount += 1;
    if (y >= height - edgeRows) bottomEdgeCount += 1;
    if (x < edgeColumns) leftEdgeCount += 1;
    if (x >= width - edgeColumns) rightEdgeCount += 1;
  }

  if (totalMass <= 0) return null;
  const left = findQuantileIndex(columnMass, totalMass, 0.0008);
  const right = findQuantileIndex(columnMass, totalMass, 0.9992);
  const top = findQuantileIndex(rowMass, totalMass, 0.0008);
  const bottom = findQuantileIndex(rowMass, totalMass, 0.9992);
  const horizontalPadding = Math.max(1, Math.round(width * 0.006));
  const verticalPadding = Math.max(1, Math.round(height * 0.006));
  const isolationPaddingX = Math.max(2, Math.round(width * 0.018));
  const isolationPaddingY = Math.max(2, Math.round(height * 0.018));
  const edgeMinimum = Math.max(2, Math.round(Math.min(width, height) * 0.01));
  const membership = new Uint8Array(pixelCount);
  for (const index of bestComponent.indices) membership[index] = 1;

  return {
    bounds: {
      left: clamp((left - horizontalPadding) / width, 0, 1),
      top: clamp((top - verticalPadding) / height, 0, 1),
      right: clamp((right + horizontalPadding + 1) / width, 0, 1),
      bottom: clamp((bottom + verticalPadding + 1) / height, 0, 1),
    },
    clipping: {
      top: topEdgeCount >= edgeMinimum,
      bottom: bottomEdgeCount >= edgeMinimum,
      left: leftEdgeCount >= edgeMinimum,
      right: rightEdgeCount >= edgeMinimum,
    },
    isolation: {
      left: Math.max(0, componentMinX - isolationPaddingX),
      top: Math.max(0, componentMinY - isolationPaddingY),
      right: Math.min(width - 1, componentMaxX + isolationPaddingX),
      bottom: Math.min(height - 1, componentMaxY + isolationPaddingY),
      membership,
      componentThreshold,
    },
  };
}

function stabilizePersonBounds(previous, next, enabled) {
  if (!enabled || !previous) return next;
  const maximumDelta = Math.max(
    Math.abs(previous.left - next.left),
    Math.abs(previous.top - next.top),
    Math.abs(previous.right - next.right),
    Math.abs(previous.bottom - next.bottom),
  );
  const response = maximumDelta > 0.075 ? 0.72 : 0.32;
  return {
    left: previous.left + (next.left - previous.left) * response,
    top: previous.top + (next.top - previous.top) * response,
    right: previous.right + (next.right - previous.right) * response,
    bottom: previous.bottom + (next.bottom - previous.bottom) * response,
  };
}

function updateMask(result, { stabilize = true } = {}) {
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
      handlePersonMaskMiss();
      return;
    }

    const width = mask.width;
    const height = mask.height;
    const pixelCount = width * height;
    const sourceToken = getMaskSourceToken();
    const canStabilize =
      stabilize &&
      state.sourceType === "video" &&
      state.maskTemporalValues?.length === pixelCount &&
      state.maskTemporalWidth === width &&
      state.maskTemporalHeight === height &&
      state.maskTemporalSourceToken === sourceToken &&
      performance.now() - state.maskUpdatedAt < 520;
    const rawValues = new Float32Array(pixelCount);
    if (confidenceMask?.getAsFloat32Array) {
      const values = confidenceMask.getAsFloat32Array();
      for (let index = 0; index < pixelCount; index += 1) {
        rawValues[index] = clamp(values[index], 0, 1);
      }
    } else {
      const values = categoryMask.getAsUint8Array();
      for (let index = 0; index < pixelCount; index += 1) {
        rawValues[index] = values[index] > 0 ? 1 : 0;
      }
    }

    const temporalValues = new Float32Array(pixelCount);
    for (let index = 0; index < pixelCount; index += 1) {
      const current = rawValues[index];
      if (!canStabilize) {
        temporalValues[index] = current;
        continue;
      }
      const previous = state.maskTemporalValues[index];
      const difference = Math.abs(current - previous);
      const response = difference > 0.34 ? 0.76 : 0.38;
      temporalValues[index] = previous + (current - previous) * response;
    }

    state.maskTemporalValues = temporalValues;
    state.maskTemporalWidth = width;
    state.maskTemporalHeight = height;
    state.maskTemporalSourceToken = sourceToken;
    state.maskCanvas.width = width;
    state.maskCanvas.height = height;
    const maskContext = state.maskCanvas.getContext("2d");
    const output = maskContext.createImageData(width, height);
    const alphaValues = new Float32Array(pixelCount);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const confidence = temporalValues[index];
        let refinedConfidence = confidence;
        if (
          confidence > 0.025 &&
          confidence < 0.975 &&
          x > 0 &&
          x + 1 < width &&
          y > 0 &&
          y + 1 < height
        ) {
          const neighborAverage =
            (temporalValues[index - 1] +
              temporalValues[index + 1] +
              temporalValues[index - width] +
              temporalValues[index + width]) /
            4;
          refinedConfidence = confidence * 0.64 + neighborAverage * 0.36;
        }

        const feathered = smoothStep(0.045, 0.79, refinedConfidence);
        const alpha =
          feathered > 0.82
            ? 1 - (1 - feathered) * 0.48
            : Math.pow(feathered, 0.88);
        alphaValues[index] = alpha;
        const pixelIndex = index * 4;
        output.data[pixelIndex] = 255;
        output.data[pixelIndex + 1] = 255;
        output.data[pixelIndex + 2] = 255;
        output.data[pixelIndex + 3] = Math.round(alpha * 255);
      }
    }

    const personRegion = findPrimaryPersonRegion(alphaValues, width, height);
    if (!personRegion) {
      handlePersonMaskMiss();
      return;
    }

    const isolation = personRegion.isolation;
    for (let index = 0; index < pixelCount; index += 1) {
      const x = index % width;
      const y = Math.floor(index / width);
      const outsidePrimaryBounds =
        x < isolation.left ||
        x > isolation.right ||
        y < isolation.top ||
        y > isolation.bottom;
      const belongsToOtherStrongRegion =
        alphaValues[index] >= isolation.componentThreshold &&
        !isolation.membership[index];
      if (outsidePrimaryBounds || belongsToOtherStrongRegion) {
        output.data[index * 4 + 3] = 0;
      }
    }

    maskContext.putImageData(output, 0, 0);
    state.personBounds = stabilizePersonBounds(
      state.personBounds,
      personRegion.bounds,
      canStabilize,
    );
    state.personClipping = personRegion.clipping;
    state.staticMaskAttempts = 0;
    state.maskAvailable = true;
    state.maskUpdatedAt = performance.now();
    updateAiStatus("ready", "AI 인물 분리 켜짐");
    updateCaptureReadiness();
    updateFramingGuidance();
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
    updateFramingGuidance();
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
      const visionTasks = await import(/* @vite-ignore */ MEDIAPIPE_MODULE);
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
  if (state.sourceType === "image") {
    state.staticMaskRequested = true;
    state.staticMaskAttempts += 1;
  }
  if (state.sourceType === "video") {
    state.lastVideoTime = cameraVideo.currentTime;
  }

  const generation = state.segmentationGeneration;
  let settled = false;
  const inferenceTime = Math.max(Math.round(timestamp), state.maskUpdatedAt + 1);
  const finish = (result) => {
    if (settled) {
      closeMaskResources(result);
      return;
    }
    if (generation !== state.segmentationGeneration) {
      settled = true;
      closeMaskResources(result);
      return;
    }
    settled = true;
    updateMask(result, { stabilize: state.sourceType === "video" });
  };

  try {
    const maybeResult = state.segmenter.segmentForVideo(
      source,
      inferenceTime,
      finish,
    );
    if (maybeResult?.categoryMask || maybeResult?.confidenceMasks) {
      finish(maybeResult);
    } else {
      window.setTimeout(() => {
        if (generation !== state.segmentationGeneration) return;
        if (settled) return;
        settled = true;
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
  state.segmentationGeneration += 1;
  state.isSegmenting = false;
  resetTemporalMask();
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  cameraVideo.srcObject = null;
  switchCameraButton.disabled = true;
  cameraSelect.disabled = true;
  state.framingReady = false;
  state.framingReadySince = 0;
  updateFramingGuidance();
}

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function updateCameraViewportHeight() {
  if (!state.cameraModeActive) return;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const cameraChromeHeight = viewportHeight <= 650 ? 154 : 182;
  const stageHeight = Math.max(160, viewportHeight - cameraChromeHeight);
  document.documentElement.style.setProperty(
    "--camera-viewport-height",
    `${Math.round(viewportHeight)}px`,
  );
  document.documentElement.style.setProperty(
    "--camera-stage-width",
    `${Math.round(stageHeight * 0.8)}px`,
  );
  document.documentElement.style.setProperty(
    "--camera-stage-height",
    `${Math.round(stageHeight)}px`,
  );
}

function activateCameraModeUi() {
  if (!state.cameraModeActive) {
    state.cameraModeScrollY = Math.max(0, window.scrollY);
  }
  state.cameraModeActive = true;
  document.body.style.top = `-${state.cameraModeScrollY}px`;
  document.body.classList.add("is-camera-mode");
  exitCameraModeButton.hidden = false;
  updateCameraViewportHeight();
}

function deactivateCameraModeUi({ restoreScroll = true } = {}) {
  const scrollY = state.cameraModeScrollY;
  state.cameraModeActive = false;
  document.body.classList.remove("is-camera-mode");
  document.body.style.top = "";
  exitCameraModeButton.hidden = true;
  document.documentElement.style.removeProperty("--camera-viewport-height");
  document.documentElement.style.removeProperty("--camera-stage-width");
  document.documentElement.style.removeProperty("--camera-stage-height");
  if (restoreScroll) window.scrollTo(0, scrollY);
}

function enterCameraMode() {
  activateCameraModeUi();

  if (getFullscreenElement() === document.documentElement) {
    state.nativeFullscreenActive = true;
    return Promise.resolve(true);
  }

  try {
    let fullscreenResult;
    if (document.documentElement.requestFullscreen) {
      fullscreenResult = document.documentElement.requestFullscreen({
        navigationUI: "hide",
      });
    } else if (document.documentElement.webkitRequestFullscreen) {
      fullscreenResult = document.documentElement.webkitRequestFullscreen();
    } else {
      return Promise.resolve(false);
    }

    return Promise.resolve(fullscreenResult)
      .then(() => {
        state.nativeFullscreenActive =
          getFullscreenElement() === document.documentElement;
        return state.nativeFullscreenActive;
      })
      .catch((error) => {
        console.info("브라우저 전체화면 대신 몰입형 촬영 화면을 사용합니다.", error);
        state.nativeFullscreenActive = false;
        return false;
      });
  } catch (error) {
    console.info("브라우저 전체화면 대신 몰입형 촬영 화면을 사용합니다.", error);
    state.nativeFullscreenActive = false;
    return Promise.resolve(false);
  }
}

function cancelPendingCapture() {
  state.captureSequence += 1;
  countdownElement.textContent = "";
  countdownElement.classList.remove("pop");
  cameraStage.classList.remove("is-counting");
}

async function exitCameraMode({
  cancelCapture = true,
  exitNative = true,
} = {}) {
  if (cancelCapture) cancelPendingCapture();
  if (
    !state.cameraModeActive &&
    getFullscreenElement() !== document.documentElement
  ) {
    return;
  }
  if (state.fullscreenExitInProgress) return;

  state.fullscreenExitInProgress = true;
  const scrollY = state.cameraModeScrollY;
  let fullscreenExit = Promise.resolve();

  if (
    exitNative &&
    getFullscreenElement() === document.documentElement
  ) {
    try {
      const result = document.exitFullscreen
        ? document.exitFullscreen()
        : document.webkitExitFullscreen?.();
      fullscreenExit = Promise.resolve(result);
    } catch (error) {
      console.info("브라우저 전체화면 종료를 완료하지 못했습니다.", error);
    }
  }

  deactivateCameraModeUi({ restoreScroll: false });
  try {
    await fullscreenExit;
  } catch (error) {
    console.info("브라우저 전체화면 종료를 완료하지 못했습니다.", error);
  } finally {
    state.nativeFullscreenActive = false;
    state.fullscreenExitInProgress = false;
    window.scrollTo(0, scrollY);
  }
}

function handleFullscreenChange() {
  const isOwnFullscreen =
    getFullscreenElement() === document.documentElement;
  if (isOwnFullscreen) {
    state.nativeFullscreenActive = true;
    return;
  }

  const ownFullscreenEnded = state.nativeFullscreenActive;
  state.nativeFullscreenActive = false;
  if (
    ownFullscreenEnded &&
    state.cameraModeActive &&
    !state.fullscreenExitInProgress
  ) {
    void exitCameraMode({ exitNative: false });
  }
}

function showCameraMessage(message) {
  cameraMessage.textContent = message;
  cameraMessage.hidden = !message;
}

function getCameraLabel(device, index) {
  return device.label.trim() || `카메라 ${index + 1}`;
}

function isExternalCameraLabel(label) {
  return /gopro|cam\s?link|capture|usb|external|외장|캡처/i.test(label);
}

async function refreshCameraDevices({ announce = false } = {}) {
  if (!navigator.mediaDevices?.enumerateDevices) {
    cameraSelect.disabled = true;
    refreshCamerasButton.disabled = true;
    cameraDeviceStatus.textContent = "이 브라우저에서는 카메라 목록을 불러올 수 없어요.";
    return [];
  }

  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "videoinput",
    );
    state.cameraDevices = devices;

    const activeDeviceId =
      state.stream?.getVideoTracks()[0]?.getSettings?.().deviceId ||
      state.selectedCameraId;
    const fragment = document.createDocumentFragment();
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "시스템 기본 카메라";
    fragment.append(defaultOption);

    devices.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = getCameraLabel(device, index);
      fragment.append(option);
    });
    cameraSelect.replaceChildren(fragment);

    const activeDevice = devices.find(
      (device) => device.deviceId && device.deviceId === activeDeviceId,
    );
    if (activeDevice) {
      state.selectedCameraId = activeDevice.deviceId;
      cameraSelect.value = activeDevice.deviceId;
    } else if (
      state.selectedCameraId &&
      !devices.some((device) => device.deviceId === state.selectedCameraId)
    ) {
      state.selectedCameraId = "";
      cameraSelect.value = "";
    }

    cameraSelect.disabled = state.captureInProgress || devices.length === 0;
    refreshCamerasButton.disabled = state.captureInProgress;
    switchCameraButton.disabled =
      state.captureInProgress || (!state.stream && devices.length < 2);

    const selectedDevice = devices.find(
      (device) => device.deviceId === state.selectedCameraId,
    );
    if (selectedDevice) {
      const selectedIndex = devices.indexOf(selectedDevice);
      const selectedLabel = getCameraLabel(selectedDevice, selectedIndex);
      const isExternal = isExternalCameraLabel(selectedLabel);
      cameraDeviceStatus.textContent = `${selectedLabel} 연결됨${
        isExternal ? " · 외장 카메라" : ""
      }`;
      cameraDeviceStatus.classList.toggle("is-external", isExternal);
    } else {
      cameraDeviceStatus.textContent = devices.length
        ? `${devices.length}개의 카메라를 찾았어요.`
        : "연결된 카메라를 찾지 못했어요.";
      cameraDeviceStatus.classList.remove("is-external");
    }

    if (announce) {
      showToast(
        devices.length
          ? `${devices.length}개의 카메라를 확인했어요.`
          : "연결된 카메라를 찾지 못했어요.",
      );
    }
    return devices;
  } catch {
    cameraSelect.disabled = true;
    cameraDeviceStatus.textContent = "카메라 목록을 새로 불러오지 못했어요.";
    return [];
  }
}

function getCameraErrorMessage(error) {
  const messages = {
    NotAllowedError:
      "카메라 권한이 꺼져 있어요. 브라우저 설정에서 허용하거나 ‘사진 불러오기’를 이용해 주세요.",
    NotFoundError:
      "사용할 수 있는 카메라를 찾지 못했어요. 외장 카메라 연결을 확인하거나 사진을 불러와 주세요.",
    NotReadableError:
      "다른 앱이 카메라를 사용 중인 것 같아요. 다른 앱을 닫고 다시 시도해 주세요.",
    OverconstrainedError:
      "선택한 카메라를 열 수 없어 기본 카메라로 다시 시도해 주세요.",
    SecurityError:
      "카메라는 보안 연결(HTTPS)이나 localhost에서만 사용할 수 있어요.",
  };
  return messages[error?.name] || "카메라를 시작하지 못했어요. 사진 불러오기로 계속할 수 있어요.";
}

async function tuneCameraTrackForPortrait(track) {
  if (!track) return;
  try {
    if ("contentHint" in track) track.contentHint = "detail";
    const capabilities = track.getCapabilities?.() || {};
    const advanced = {};
    [
      ["focusMode", "continuous"],
      ["exposureMode", "continuous"],
      ["whiteBalanceMode", "continuous"],
    ].forEach(([name, preferredValue]) => {
      if (capabilities[name]?.includes?.(preferredValue)) {
        advanced[name] = preferredValue;
      }
    });
    if (Object.keys(advanced).length) {
      await track.applyConstraints({ advanced: [advanced] });
    }
  } catch (error) {
    console.info("카메라 자동 초점·노출은 기본 설정을 사용합니다.", error);
  }
}

async function startCamera({ allowDeviceFallback = true } = {}) {
  if (state.captureInProgress) return false;
  if (!navigator.mediaDevices?.getUserMedia) {
    showCameraMessage("이 브라우저에서는 카메라 촬영을 지원하지 않아요. 사진 불러오기를 이용해 주세요.");
    portraitUpload.click();
    return false;
  }

  showCameraMessage("");
  captureButton.disabled = true;
  cameraSelect.disabled = true;
  refreshCamerasButton.disabled = true;
  updateAiStatus("loading", "카메라 연결 중");
  const requestId = state.cameraRequestId + 1;
  state.cameraRequestId = requestId;
  stopCamera({ invalidatePending: false });
  const requestedDeviceId = state.selectedCameraId;

  try {
    const videoConstraints = {
      width: { ideal: 2560 },
      height: { ideal: 1920 },
      aspectRatio: { ideal: 4 / 3 },
      frameRate: { ideal: 30, max: 60 },
      ...(requestedDeviceId
        ? { deviceId: { exact: requestedDeviceId } }
        : { facingMode: { ideal: state.facingMode } }),
    };
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: videoConstraints,
    });

    if (requestId !== state.cameraRequestId) {
      stream.getTracks().forEach((track) => track.stop());
      return false;
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

    const videoTrack = stream.getVideoTracks()[0];
    await tuneCameraTrackForPortrait(videoTrack);
    if (requestId !== state.cameraRequestId) {
      stream.getTracks().forEach((track) => track.stop());
      if (cameraVideo.srcObject === stream) cameraVideo.srcObject = null;
      return false;
    }
    const trackSettings = videoTrack?.getSettings?.() || {};
    const actualFacingMode = trackSettings.facingMode;
    if (trackSettings.deviceId) {
      state.selectedCameraId = trackSettings.deviceId;
    }
    if (actualFacingMode) {
      state.facingMode = actualFacingMode;
      state.mirror = actualFacingMode === "user";
    } else if (requestedDeviceId) {
      state.mirror = false;
    }
    videoTrack?.addEventListener(
      "ended",
      () => {
        if (state.stream?.getVideoTracks()[0] !== videoTrack) return;
        state.stream = null;
        cameraVideo.srcObject = null;
        state.sourceType = null;
        state.maskAvailable = false;
        state.personBounds = null;
        state.personClipping = null;
        state.segmentationGeneration += 1;
        state.isSegmenting = false;
        resetTemporalMask();
        cameraStage.classList.remove("has-source");
        captureButton.disabled = true;
        switchCameraButton.disabled = true;
        showCameraMessage(
          "카메라 연결이 끊겼어요. 케이블이나 웹캠 모드를 확인한 뒤 ‘다시 찾기’를 눌러 주세요.",
        );
        updateAiStatus("fallback", "카메라 다시 연결 필요");
        refreshCameraDevices();
      },
      { once: true },
    );
    state.sourceType = "video";
    state.sourceWasCamera = true;
    state.cameraPausedAfterCapture = false;
    state.maskAvailable = false;
    state.personBounds = null;
    state.personClipping = null;
    state.segmentationGeneration += 1;
    resetTemporalMask();
    state.staticMaskRequested = false;
    state.staticMaskAttempts = 0;
    state.lastVideoTime = -1;
    cameraStage.classList.add("has-source");
    updateFramingGuidance();
    mirrorButton.disabled = false;
    mirrorButton.setAttribute("aria-pressed", String(state.mirror));
    updateAiStatus("loading", "AI 인물 분리 준비 중");
    await refreshCameraDevices();

    loadSegmenter().then(() => {
      if (!state.segmenter) {
        updateAiStatus("fallback", "소프트 인물 합성");
      }
      updateCaptureReadiness();
    });
    return true;
  } catch (error) {
    if (requestId !== state.cameraRequestId) return false;
    if (
      requestedDeviceId &&
      allowDeviceFallback &&
      ["NotFoundError", "OverconstrainedError"].includes(error?.name)
    ) {
      state.selectedCameraId = "";
      showToast("선택한 카메라를 찾지 못해 기본 카메라로 다시 연결해요.");
      await refreshCameraDevices();
      return startCamera({ allowDeviceFallback: false });
    }
    showCameraMessage(getCameraErrorMessage(error));
    updateAiStatus("fallback", "사진 불러오기 사용 가능");
    refreshCamerasButton.disabled = false;
    cameraSelect.disabled = state.cameraDevices.length === 0;
    if (state.sourceType === "video") {
      state.sourceType = null;
      cameraStage.classList.remove("has-source");
    }
    if (state.sourceType === "image" && getSource()) {
      updateCaptureReadiness();
    } else {
      captureButton.disabled = true;
    }
    return false;
  }
}

function startCameraExperience() {
  const fullscreenAttempt = enterCameraMode();
  const cameraAttempt = startCamera();
  void Promise.all([fullscreenAttempt, cameraAttempt]).then(
    async ([, started]) => {
      if (!started) {
        await exitCameraMode({ cancelCapture: false });
      }
    },
  );
}

async function switchCamera() {
  if (state.captureInProgress) return;
  const devices = await refreshCameraDevices();
  if (devices.length > 1) {
    const currentIndex = devices.findIndex(
      (device) => device.deviceId === state.selectedCameraId,
    );
    const nextDevice = devices[(currentIndex + 1 + devices.length) % devices.length];
    state.selectedCameraId = nextDevice.deviceId;
    await startCamera();
    return;
  }

  state.selectedCameraId = "";
  state.facingMode = state.facingMode === "user" ? "environment" : "user";
  state.mirror = state.facingMode === "user";
  mirrorButton.setAttribute("aria-pressed", String(state.mirror));
  await startCamera();
}

async function selectCameraDevice(event) {
  if (state.captureInProgress) return;
  state.selectedCameraId = event.target.value;
  await startCamera();
}

async function refreshConnectedCameras() {
  if (state.captureInProgress) return;
  if (!state.stream) {
    await startCamera();
    return;
  }
  await refreshCameraDevices({ announce: true });
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

  await exitCameraMode({ cancelCapture: false });
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
    state.personClipping = null;
    state.segmentationGeneration += 1;
    state.isSegmenting = false;
    resetTemporalMask();
    state.staticMaskRequested = false;
    state.staticMaskAttempts = 0;
    cameraStage.classList.add("has-source");
    updateFramingGuidance();
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
  document
    .querySelectorAll(".background-option, #backgroundUploadButton")
    .forEach((button) => {
      const isSelected = button === selectedButton;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
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
    state.backgroundPath = "";
    state.backgroundTone = "custom";

    const uploadButton = byId("backgroundUploadButton");
    uploadButton.classList.add("has-preview");
    uploadButton.style.setProperty(
      "--custom-background",
      `url("${state.customBackgroundUrl}")`,
    );
    uploadButton.querySelector("strong").textContent = "내 배경";
    uploadButton.querySelector("small").textContent = file.name;
    selectBackgroundButton(uploadButton);
    showToast("내 배경을 적용했어요.");
  } catch {
    showToast("배경 사진을 불러오지 못했어요.");
  }
}

async function selectBuiltInBackground(button) {
  if (state.captureInProgress) return;
  const path = button.dataset.background;
  if (!path) return;

  button.disabled = true;
  try {
    let image = backgroundImageCache.get(path);
    if (!image) {
      image = new Image();
      image.decoding = "async";
      image.src = path;
      backgroundImageCache.set(path, image);
    }
    await waitForImage(image);
    state.backgroundImage = image;
    state.backgroundPath = path;
    state.backgroundTone = button.dataset.tone || "golden";
    selectBackgroundButton(button);
  } catch {
    backgroundImageCache.delete(path);
    showToast("선택한 배경을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  } finally {
    button.disabled = false;
  }
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
    updateFramingGuidance();
  });

  personHeight.addEventListener("input", () => {
    state.personOffsetY = Number(personHeight.value) / 100;
    const prefix = Number(personHeight.value) > 0 ? "+" : "";
    byId("personHeightValue").textContent = `${prefix}${personHeight.value}`;
    updateFramingGuidance();
  });

  shadowStrength.addEventListener("input", () => {
    state.shadowStrength = Number(shadowStrength.value) / 100;
    byId("shadowValue").textContent = `${shadowStrength.value}%`;
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForSegmentationIdle(timeout = 900) {
  const startedAt = performance.now();
  while (
    state.isSegmenting &&
    performance.now() - startedAt < timeout
  ) {
    await wait(16);
  }
  return !state.isSegmenting;
}

async function snapshotNextVideoFrame(video, targetCanvas, maxEdge) {
  await new Promise((resolve) => {
    let settled = false;
    let callbackId = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve();
    };
    const timeoutId = window.setTimeout(finish, 280);

    if (typeof video.requestVideoFrameCallback === "function") {
      callbackId = video.requestVideoFrameCallback(finish);
    } else {
      window.requestAnimationFrame(finish);
    }

    window.setTimeout(() => {
      if (
        settled &&
        callbackId &&
        typeof video.cancelVideoFrameCallback === "function"
      ) {
        video.cancelVideoFrameCallback(callbackId);
      }
    }, 300);
  });
  return snapshotSource(video, targetCanvas, maxEdge);
}

function withTimeout(promise, timeout, message) {
  let timeoutId = 0;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error(message)), timeout);
    }),
  ]).finally(() => window.clearTimeout(timeoutId));
}

async function drawPhotoBlobToCanvas(blob, targetCanvas, maxEdge) {
  if (typeof window.createImageBitmap === "function") {
    let bitmap = null;
    try {
      try {
        bitmap = await createImageBitmap(blob, {
          imageOrientation: "from-image",
        });
      } catch {
        bitmap = await createImageBitmap(blob);
      }
      return snapshotSource(bitmap, targetCanvas, maxEdge);
    } finally {
      bitmap?.close?.();
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";
  image.src = objectUrl;
  try {
    await waitForImage(image);
    await image.decode?.();
    return snapshotSource(image, targetCanvas, maxEdge);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function getPhotoSettings(capabilities, maxEdge) {
  const widthCapability = capabilities?.imageWidth;
  const heightCapability = capabilities?.imageHeight;
  if (!widthCapability?.max || !heightCapability?.max) return null;
  const scale = Math.min(
    1,
    maxEdge / Math.max(widthCapability.max, heightCapability.max),
  );
  const imageWidth = Math.round(
    clamp(
      widthCapability.max * scale,
      widthCapability.min || 1,
      widthCapability.max,
    ),
  );
  const imageHeight = Math.round(
    clamp(
      heightCapability.max * scale,
      heightCapability.min || 1,
      heightCapability.max,
    ),
  );
  return { imageWidth, imageHeight };
}

function scoreFrameSharpness(canvas) {
  sharpnessSampleCanvas.width = 96;
  sharpnessSampleCanvas.height = 96;
  const sampleContext = sharpnessSampleCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  const bounds = state.personBounds;
  const sourceWidth = canvas.width;
  const sourceHeight = canvas.height;
  const crop = bounds
    ? {
        x: clamp((bounds.left + (bounds.right - bounds.left) * 0.16) * sourceWidth, 0, sourceWidth - 1),
        y: clamp(bounds.top * sourceHeight, 0, sourceHeight - 1),
        width: clamp((bounds.right - bounds.left) * 0.68 * sourceWidth, 1, sourceWidth),
        height: clamp((bounds.bottom - bounds.top) * 0.24 * sourceHeight, 1, sourceHeight),
      }
    : {
        x: sourceWidth * 0.28,
        y: sourceHeight * 0.16,
        width: sourceWidth * 0.44,
        height: sourceHeight * 0.34,
      };
  crop.width = Math.min(crop.width, sourceWidth - crop.x);
  crop.height = Math.min(crop.height, sourceHeight - crop.y);
  sampleContext.drawImage(
    canvas,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    96,
    96,
  );
  const pixels = sampleContext.getImageData(0, 0, 96, 96).data;
  const grayscale = new Float32Array(96 * 96);
  for (let index = 0; index < grayscale.length; index += 1) {
    const pixelIndex = index * 4;
    grayscale[index] =
      pixels[pixelIndex] * 0.299 +
      pixels[pixelIndex + 1] * 0.587 +
      pixels[pixelIndex + 2] * 0.114;
  }

  let score = 0;
  for (let y = 1; y < 95; y += 1) {
    for (let x = 1; x < 95; x += 1) {
      const index = y * 96 + x;
      const laplacian =
        grayscale[index - 96] +
        grayscale[index + 96] +
        grayscale[index - 1] +
        grayscale[index + 1] -
        grayscale[index] * 4;
      score += laplacian * laplacian;
    }
  }
  return score / (94 * 94);
}

async function captureBestVideoFrame(video, targetCanvas, maxEdge) {
  let bestScore = -1;
  for (let frameIndex = 0; frameIndex < 3; frameIndex += 1) {
    await snapshotNextVideoFrame(video, fallbackFrameCanvas, maxEdge);
    const score = scoreFrameSharpness(fallbackFrameCanvas);
    if (score > bestScore) {
      bestScore = score;
      snapshotSource(fallbackFrameCanvas, targetCanvas, maxEdge);
    }
    await wait(34);
  }
  state.captureMethod = "best-video-frame";
  if (!targetCanvas.width) {
    snapshotSource(video, targetCanvas, maxEdge);
  }
  fallbackFrameCanvas.width = 0;
  fallbackFrameCanvas.height = 0;
  return targetCanvas;
}

async function captureCanonicalStill(video, targetCanvas, maxEdge) {
  const track = state.stream?.getVideoTracks()[0];
  if (track && typeof window.ImageCapture === "function") {
    try {
      const imageCapture = new window.ImageCapture(track);
      let settings = null;
      try {
        const capabilities = await withTimeout(
          imageCapture.getPhotoCapabilities(),
          900,
          "사진 해상도 확인 시간이 초과되었습니다.",
        );
        settings = getPhotoSettings(capabilities, maxEdge);
      } catch {
        // Some UVC and action cameras expose ImageCapture without capabilities.
      }

      let photoBlob = null;
      if (settings) {
        try {
          photoBlob = await withTimeout(
            imageCapture.takePhoto(settings),
            4200,
            "고해상도 사진 촬영 시간이 초과되었습니다.",
          );
        } catch {
          // Retry once without optional settings for strict camera drivers.
        }
      }
      if (!photoBlob) {
        photoBlob = await withTimeout(
          imageCapture.takePhoto(),
          4200,
          "고해상도 사진 촬영 시간이 초과되었습니다.",
        );
      }
      await drawPhotoBlobToCanvas(photoBlob, targetCanvas, maxEdge);
      state.captureMethod = "sensor-photo";
      return targetCanvas;
    } catch (error) {
      console.info("센서 정지사진 대신 선명한 영상 프레임을 사용합니다.", error);
      try {
        const imageCapture = new window.ImageCapture(track);
        const bitmap = await withTimeout(
          imageCapture.grabFrame(),
          1800,
          "카메라 프레임 촬영 시간이 초과되었습니다.",
        );
        try {
          snapshotSource(bitmap, targetCanvas, maxEdge);
        } finally {
          bitmap.close?.();
        }
        state.captureMethod = "grab-frame";
        return targetCanvas;
      } catch {
        // GoPro webcam mode and several UVC drivers only expose video frames.
      }
    }
  }

  return captureBestVideoFrame(video, targetCanvas, maxEdge);
}

function cloneCanvasInto(sourceCanvas, targetCanvas) {
  targetCanvas.width = sourceCanvas.width;
  targetCanvas.height = sourceCanvas.height;
  const context = targetCanvas.getContext("2d");
  context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  context.drawImage(sourceCanvas, 0, 0);
  return targetCanvas;
}

function createCaptureRecipe() {
  if (state.maskAvailable && state.maskCanvas.width && state.maskCanvas.height) {
    cloneCanvasInto(state.maskCanvas, captureMaskCanvas);
  } else {
    captureMaskCanvas.width = 0;
    captureMaskCanvas.height = 0;
  }
  return {
    sourceCanvas: captureFrameCanvas,
    maskCanvas: captureMaskCanvas,
    maskAvailable: state.maskAvailable,
    personBounds: state.personBounds ? { ...state.personBounds } : null,
    personClipping: state.personClipping ? { ...state.personClipping } : null,
    mirror: state.mirror,
    captureMethod: state.captureMethod,
    maskQuality: state.captureMaskQuality,
    hairColor: null,
  };
}

function throwIfCaptureCancelled(captureId) {
  if (captureId === state.captureSequence) return;
  const error = new Error("촬영이 취소되었습니다.");
  error.name = "AbortError";
  throw error;
}

async function runCountdown(seconds, captureId) {
  cameraStage.classList.add("is-counting");
  for (let number = seconds; number > 0; number -= 1) {
    throwIfCaptureCancelled(captureId);
    countdownElement.textContent = number;
    countdownElement.classList.remove("pop");
    void countdownElement.offsetWidth;
    countdownElement.classList.add("pop");
    await wait(1000);
    throwIfCaptureCancelled(captureId);
  }
  countdownElement.textContent = "";
  countdownElement.classList.remove("pop");
  cameraStage.classList.remove("is-counting");
}

function setStudioControlsLocked(locked) {
  document
    .querySelectorAll(
      ".background-option, #backgroundUploadButton, .look-option, .realism-tuning input, #timerSelect, #uploadShortcut, #mirrorButton, #switchCameraButton, #cameraSelect, #refreshCamerasButton",
    )
    .forEach((control) => {
      control.disabled = locked;
    });
}

function segmentExactFrame(source, timeout = 2800) {
  if (!state.segmenter) return Promise.resolve(false);

  const generation = state.segmentationGeneration;
  state.isSegmenting = true;
  const inferenceTime = Math.max(
    Math.round(performance.now()),
    state.maskUpdatedAt + 1,
  );

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) {
        closeMaskResources(result);
        return;
      }
      if (generation !== state.segmentationGeneration) {
        settled = true;
        closeMaskResources(result);
        resolve(false);
        return;
      }
      settled = true;
      updateMask(result, { stabilize: false });
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
          state.segmentationGeneration += 1;
          state.isSegmenting = false;
          resolve(false);
        }
      }, timeout);
    } catch (error) {
      console.warn("촬영 프레임의 인물 분리를 건너뜁니다.", error);
      state.isSegmenting = false;
      settled = true;
      resolve(false);
    }
  });
}

async function segmentCapturedPortrait(captureSource) {
  const previousMaskAvailable =
    state.maskAvailable &&
    state.maskCanvas.width > 0 &&
    state.maskCanvas.height > 0;
  const previousPersonBounds = state.personBounds
    ? { ...state.personBounds }
    : null;
  const previousPersonClipping = state.personClipping
    ? { ...state.personClipping }
    : null;
  if (previousMaskAvailable) {
    cloneCanvasInto(state.maskCanvas, previewMaskBackupCanvas);
  } else {
    previewMaskBackupCanvas.width = 0;
    previewMaskBackupCanvas.height = 0;
  }

  const resetForExactAttempt = () => {
    state.segmentationGeneration += 1;
    state.isSegmenting = false;
    state.maskAvailable = false;
    state.personBounds = null;
    state.personClipping = null;
    resetTemporalMask();
    state.maskCanvas.width = 0;
    state.maskCanvas.height = 0;
  };
  const runAttempt = async (maxEdge, timeout) => {
    resetForExactAttempt();
    return segmentExactFrame(
      snapshotSource(
        captureSource,
        state.imageInferenceCanvas,
        maxEdge,
      ),
      timeout,
    );
  };

  let exactMaskReady = await runAttempt(MAX_STILL_INFERENCE_EDGE, 3000);
  if (!exactMaskReady) {
    exactMaskReady = await runAttempt(960, 2400);
  }
  if (exactMaskReady) {
    state.captureMaskQuality = "exact";
    previewMaskBackupCanvas.width = 0;
    previewMaskBackupCanvas.height = 0;
    return true;
  }

  const captureSize = getSourceSize(captureSource);
  const previewRatio = state.segmentationFrameCanvas.height
    ? state.segmentationFrameCanvas.width / state.segmentationFrameCanvas.height
    : 0;
  const captureRatio = captureSize.height
    ? captureSize.width / captureSize.height
    : 0;
  const canReusePreviewMask =
    previousMaskAvailable &&
    previousPersonBounds &&
    Math.abs(previewRatio - captureRatio) < 0.035;

  state.personBounds = previousPersonBounds;
  state.personClipping = previousPersonClipping;
  if (canReusePreviewMask) {
    cloneCanvasInto(previewMaskBackupCanvas, state.maskCanvas);
    state.maskAvailable = true;
    state.maskUpdatedAt = performance.now();
    state.captureMaskQuality = "preview";
    updateAiStatus("ready", "촬영 프레임 인물 경계 사용");
  } else {
    state.maskCanvas.width = 0;
    state.maskCanvas.height = 0;
    state.maskAvailable = false;
    state.captureMaskQuality = "soft";
    updateAiStatus("fallback", "부드러운 인물 합성");
  }
  previewMaskBackupCanvas.width = 0;
  previewMaskBackupCanvas.height = 0;
  return false;
}

function canvasToBlob(canvas, type = "image/jpeg", quality = 0.94) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("사진 파일을 만들지 못했습니다."));
    }, type, quality);
  });
}

function updateStyleEditStatus(mode, title, detail) {
  if (!styleEditStatus) return;
  styleEditStatus.dataset.state = mode;
  const titleElement = styleEditStatus.querySelector("strong");
  const detailElement = styleEditStatus.querySelector("small");
  if (titleElement) titleElement.textContent = title;
  if (detailElement) detailElement.textContent = detail;
}

function setResultEditorFinalized(finalized) {
  state.resultFinalized = finalized;
  resultStyleEditor?.classList.toggle("is-finalized", finalized);
  resultStyleEditor
    ?.querySelectorAll(
      "[data-result-background], [data-result-custom-background], [data-hair-style], [data-result-look]",
    )
    .forEach((button) => {
      const hairUnavailable =
        button.matches("[data-hair-style]") &&
        button.dataset.hairStyle !== "original" &&
        !state.captureRecipe?.personBounds;
      button.disabled = finalized || hairUnavailable;
      if (button.matches("[data-hair-style]")) {
        button.title = hairUnavailable
          ? "머리와 얼굴 경계를 찾은 사진에서 사용할 수 있어요."
          : "";
      }
    });
  if (finalizeStyleButton) {
    finalizeStyleButton.disabled = finalized;
    finalizeStyleButton.textContent = finalized
      ? "스타일 완성됨"
      : "이 스타일로 완성";
  }
}

function setSelectedResultOption(selector, selectedButton) {
  document.querySelectorAll(selector).forEach((button) => {
    const isSelected = button === selectedButton;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
}

function syncResultStyleSelections() {
  const customBackgroundButton = document.querySelector(
    "[data-result-custom-background]",
  );
  if (customBackgroundButton) {
    const customImage = customBackgroundButton.querySelector("img");
    const customAvailable =
      Boolean(state.customBackground?.naturalWidth) &&
      Boolean(state.customBackgroundUrl);
    const customSelected = !state.backgroundPath && customAvailable;
    customBackgroundButton.hidden = !customAvailable;
    if (customImage && customAvailable) {
      customImage.src = state.customBackgroundUrl;
    }
    customBackgroundButton.classList.toggle(
      "is-selected",
      customSelected,
    );
    customBackgroundButton.setAttribute(
      "aria-pressed",
      String(customSelected),
    );
  }
  const backgroundButton = Array.from(
    document.querySelectorAll("[data-result-background]"),
  ).find((button) => button.dataset.resultBackground === state.backgroundPath);
  setSelectedResultOption(
    "[data-result-background]",
    backgroundButton || null,
  );

  const hairButton = document.querySelector(
    `[data-hair-style="${state.hairStyle}"]`,
  );
  setSelectedResultOption("[data-hair-style]", hairButton);

  const resultLook =
    state.look === "paris-film"
      ? "film"
      : state.look === "monochrome"
        ? "monochrome"
        : state.look;
  const lookButton = document.querySelector(
    `[data-result-look="${resultLook}"]`,
  );
  setSelectedResultOption("[data-result-look]", lookButton);
}

function getBackgroundToneForPath(path) {
  const sourceButton = Array.from(
    document.querySelectorAll(".background-option[data-background]"),
  ).find((button) => button.dataset.background === path);
  return sourceButton?.dataset.tone || "golden";
}

async function renderCapturedResult(revision = ++state.resultRenderRevision) {
  const recipe = state.captureRecipe;
  if (!recipe || revision !== state.resultRenderRevision) return false;
  window.clearTimeout(state.resultRenderTimer);
  state.resultRenderTimer = 0;
  if (finalizeStyleButton) finalizeStyleButton.disabled = true;
  updateStyleEditStatus(
    "changing",
    "선택한 스타일을 적용하는 중",
    "고해상도 원본과 정밀 인물 경계로 사진을 다시 만들고 있어요.",
  );

  try {
    await wait(16);
    if (revision !== state.resultRenderRevision) return false;
    const exportContext = exportCanvas.getContext("2d", { alpha: false });
    renderComposite(
      exportContext,
      EXPORT_WIDTH,
      EXPORT_HEIGHT,
      recipe.sourceCanvas,
      recipe,
    );
    const blob = await canvasToBlob(exportCanvas);
    if (revision !== state.resultRenderRevision) return false;
    setResultBlob(blob, { awaitingFinalize: true });
    updateStyleEditStatus(
      "success",
      "미리보기에 반영했어요",
      "얼굴 원본은 유지하고 선택한 배경과 헤어 무드만 합성했습니다.",
    );
    return true;
  } catch (error) {
    console.error("촬영 후 스타일을 적용하지 못했습니다.", error);
    updateStyleEditStatus(
      "error",
      "스타일을 적용하지 못했어요",
      "다른 스타일을 선택하거나 다시 촬영해 주세요.",
    );
    return false;
  } finally {
    if (
      revision === state.resultRenderRevision &&
      finalizeStyleButton &&
      !state.resultFinalized
    ) {
      finalizeStyleButton.disabled = false;
    }
  }
}

function queueCapturedResultRender() {
  if (!state.captureRecipe || state.resultFinalized) return;
  const revision = ++state.resultRenderRevision;
  window.clearTimeout(state.resultRenderTimer);
  updateStyleEditStatus(
    "changing",
    "선택한 스타일을 준비하는 중",
    "얼굴 선명도와 머리카락 경계를 그대로 지키며 적용합니다.",
  );
  if (finalizeStyleButton) finalizeStyleButton.disabled = true;
  state.resultRenderTimer = window.setTimeout(() => {
    state.resultRenderPromise = renderCapturedResult(revision).finally(() => {
      if (revision === state.resultRenderRevision) {
        state.resultRenderPromise = null;
      }
    });
  }, 110);
}

async function flushCapturedResultRender() {
  let renderSucceeded = true;
  if (state.resultRenderTimer) {
    window.clearTimeout(state.resultRenderTimer);
    state.resultRenderTimer = 0;
    const revision = state.resultRenderRevision;
    state.resultRenderPromise = renderCapturedResult(revision).finally(() => {
      if (revision === state.resultRenderRevision) {
        state.resultRenderPromise = null;
      }
    });
  }
  if (state.resultRenderPromise) {
    renderSucceeded = await state.resultRenderPromise;
  }
  return renderSucceeded && Boolean(state.resultBlob);
}

async function selectResultBackground(button) {
  if (!state.captureRecipe || state.resultFinalized) return;
  const path = button.dataset.resultBackground;
  if (!path) return;
  const requestId = ++state.resultBackgroundRequest;
  let settlePendingBackground = null;
  const pendingBackground = new Promise((resolve) => {
    settlePendingBackground = resolve;
  });
  state.resultBackgroundPromise = pendingBackground;
  button.disabled = true;
  if (finalizeStyleButton) finalizeStyleButton.disabled = true;
  updateStyleEditStatus(
    "changing",
    "새 배경을 불러오는 중",
    "고해상도 배경 위에 촬영한 인물을 다시 배치하고 있어요.",
  );
  try {
    let image = backgroundImageCache.get(path);
    if (!image) {
      image = new Image();
      image.decoding = "async";
      image.src = path;
      backgroundImageCache.set(path, image);
    }
    await waitForImage(image);
    if (requestId !== state.resultBackgroundRequest || state.resultFinalized) {
      return;
    }
    state.backgroundImage = image;
    state.backgroundPath = path;
    state.backgroundTone = getBackgroundToneForPath(path);
    const sourceButton = Array.from(
      document.querySelectorAll(".background-option[data-background]"),
    ).find((option) => option.dataset.background === path);
    if (sourceButton) selectBackgroundButton(sourceButton);
    syncResultStyleSelections();
    queueCapturedResultRender();
  } catch {
    backgroundImageCache.delete(path);
    updateStyleEditStatus(
      "error",
      "배경을 불러오지 못했어요",
      "잠시 후 다시 선택해 주세요.",
    );
  } finally {
    settlePendingBackground?.();
    if (state.resultBackgroundPromise === pendingBackground) {
      state.resultBackgroundPromise = null;
    }
    if (!state.resultFinalized) button.disabled = false;
    if (
      !state.resultFinalized &&
      !state.resultBackgroundPromise &&
      !state.resultRenderTimer &&
      !state.resultRenderPromise &&
      finalizeStyleButton
    ) {
      finalizeStyleButton.disabled = false;
    }
  }
}

function selectResultCustomBackground(button) {
  if (
    !state.captureRecipe ||
    state.resultFinalized ||
    !state.customBackground?.naturalWidth
  ) {
    return;
  }
  state.resultBackgroundRequest += 1;
  state.resultBackgroundPromise = null;
  state.backgroundImage = state.customBackground;
  state.backgroundPath = "";
  state.backgroundTone = "custom";
  selectBackgroundButton(byId("backgroundUploadButton"));
  syncResultStyleSelections();
  queueCapturedResultRender();
}

function selectResultHair(button) {
  if (!state.captureRecipe || state.resultFinalized) return;
  if (!state.captureRecipe.personBounds) {
    updateStyleEditStatus(
      "error",
      "헤어 무드를 적용할 수 없어요",
      "머리와 얼굴이 선명하게 보이도록 다시 촬영해 주세요.",
    );
    return;
  }
  state.hairStyle = button.dataset.hairStyle || "original";
  syncResultStyleSelections();
  queueCapturedResultRender();
}

function selectResultLook(button) {
  if (!state.captureRecipe || state.resultFinalized) return;
  const lookMap = {
    crisp: "crisp",
    natural: "natural",
    film: "paris-film",
    monochrome: "monochrome",
  };
  state.look = lookMap[button.dataset.resultLook] || "crisp";
  syncResultStyleSelections();
  queueCapturedResultRender();
}

function setResultBlob(blob, { awaitingFinalize = false } = {}) {
  if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
  state.resultBlob = blob;
  state.resultUrl = URL.createObjectURL(blob);
  state.resultRevision += 1;
  state.driveUploadId =
    crypto.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}-photo`;
  state.driveFilename = buildFilename();
  state.driveUploadPromise = null;
  resultImage.src = state.resultUrl;
  setDriveUiState(
    "idle",
    awaitingFinalize ? "스타일 확정 후 자동 저장" : "Google Drive 자동 저장 대기",
    awaitingFinalize
      ? "‘이 스타일로 완성’을 누르면 최종 사진만 Google Drive에 저장해요."
      : "촬영본을 Photo-Mix 폴더에 안전하게 보관할 준비가 됐어요.",
  );
}

function setDriveUiState(mode, title, detail, { retry = false } = {}) {
  const headerLabels = {
    idle: "Drive 자동 저장 대기",
    saving: "Drive 저장 중",
    success: "Drive 저장 완료",
    error: "Drive 저장 실패",
    setup: "Drive 연결 필요",
  };

  if (driveHeaderStatus) driveHeaderStatus.dataset.state = mode;
  if (driveHeaderText) {
    driveHeaderText.textContent = headerLabels[mode] || headerLabels.idle;
  }
  if (driveSaveCard) driveSaveCard.dataset.state = mode;
  if (driveSaveStatus) driveSaveStatus.textContent = title;
  if (driveSaveDetail) driveSaveDetail.textContent = detail;
  if (driveRetryButton) driveRetryButton.hidden = !retry;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function uploadPhotoToDrive({ manualRetry = false } = {}) {
  if (!state.resultBlob) return false;
  if (state.driveUploadPromise) {
    return state.driveUploadPromise;
  }
  const resultRevision = state.resultRevision;
  const resultBlob = state.resultBlob;
  const uploadId = state.driveUploadId;
  const filename = state.driveFilename;
  const isCurrentUpload = () => resultRevision === state.resultRevision;

  const upload = async () => {
    const retryDelays = [0, 800, 2000];
    if (isCurrentUpload()) {
      setDriveUiState(
        "saving",
        "Google Drive에 저장하는 중",
        "Photo-Mix 폴더로 최종 촬영본을 안전하게 전송하고 있어요.",
      );
    }

    for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
      if (retryDelays[attempt]) await wait(retryDelays[attempt]);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 25000);

      try {
        const response = await fetch(DRIVE_UPLOAD_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": resultBlob.type || "image/jpeg",
            "X-Upload-Id": uploadId,
            "X-Photo-Filename": encodeURIComponent(filename),
          },
          body: resultBlob,
          signal: controller.signal,
        });
        const data = await parseJsonResponse(response);

        if (response.ok && data.ok) {
          if (isCurrentUpload()) {
            setDriveUiState(
              "success",
              "Google Drive 저장 완료",
              `${data.name || filename} · Photo-Mix 폴더`,
            );
            showToast("완성한 사진을 Google Drive에 자동 저장했어요.");
          }
          return true;
        }

        if (data.code === "DRIVE_NOT_CONFIGURED") {
          if (isCurrentUpload()) {
            setDriveUiState(
              "setup",
              "Google Drive 연결 설정이 필요해요",
              "폴더 소유자 권한으로 한 번 연결하면 다음 촬영부터 자동 저장됩니다.",
              { retry: true },
            );
          }
          return false;
        }

        const retryable =
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;
        if (!retryable || attempt === retryDelays.length - 1) {
          throw Object.assign(new Error(data.message || "Drive upload failed"), {
            retryable: false,
          });
        }
      } catch (error) {
        const retryable =
          error?.name === "AbortError" ||
          error?.name === "TypeError" ||
          error?.retryable !== false;
        if (!retryable || attempt === retryDelays.length - 1) {
          console.warn("Google Drive 자동 저장을 완료하지 못했습니다.", error);
          if (isCurrentUpload()) {
            setDriveUiState(
              "error",
              "Google Drive 저장에 실패했어요",
              "사진은 이 화면에 그대로 있어요. 연결을 확인한 뒤 다시 시도해 주세요.",
              { retry: true },
            );
          }
          return false;
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }

    return false;
  };

  const trackedPromise = upload().finally(() => {
    if (state.driveUploadPromise === trackedPromise) {
      state.driveUploadPromise = null;
    }
  });
  state.driveUploadPromise = trackedPromise;
  return trackedPromise;
}

async function finalizeCapturedResult() {
  if (!state.captureRecipe) return false;
  if (state.resultBackgroundPromise) {
    await state.resultBackgroundPromise;
  }
  if (!state.captureRecipe) return false;
  const ready = await flushCapturedResultRender();
  if (!ready) {
    updateStyleEditStatus(
      "error",
      "사진을 완성하지 못했어요",
      "잠시 후 다시 눌러 주세요.",
    );
    return false;
  }
  if (state.resultFinalized) return true;

  setResultEditorFinalized(true);
  updateStyleEditStatus(
    "success",
    "최종 스타일을 완성했어요",
    "얼굴 선명도와 원본 특징을 유지한 사진입니다.",
  );
  const revision = state.resultRevision;
  void uploadPhotoToDrive().then((saved) => {
    if (revision !== state.resultRevision || !saved) return;
    updateStyleEditStatus(
      "success",
      "완성본을 안전하게 저장했어요",
      "공유하거나 기기에 내려받을 수 있어요.",
    );
  });
  return true;
}

function discardCaptureRecipe() {
  window.clearTimeout(state.resultRenderTimer);
  state.resultRenderTimer = 0;
  state.resultRenderRevision += 1;
  state.resultRenderPromise = null;
  state.resultBackgroundRequest += 1;
  state.resultBackgroundPromise = null;
  if (state.captureRecipe && state.lookBeforeCapture) {
    state.look = state.lookBeforeCapture;
  }
  state.lookBeforeCapture = null;
  state.captureRecipe = null;
  state.hairStyle = "original";
  captureMaskCanvas.width = 0;
  captureMaskCanvas.height = 0;
}

async function checkDriveConnection() {
  try {
    const response = await fetch(DRIVE_UPLOAD_ENDPOINT, {
      method: "GET",
      cache: "no-store",
    });
    const data = await parseJsonResponse(response);
    if (response.ok && data.configured) {
      setDriveUiState(
        "idle",
        "Google Drive 자동 저장 준비 완료",
        "촬영 후 Photo-Mix 폴더에 자동으로 저장됩니다.",
      );
      return;
    }
  } catch {
    // The camera and local save flow remain available without Drive.
  }

  setDriveUiState(
    "setup",
    "Google Drive 연결 설정이 필요해요",
    "사진 촬영과 기기 저장은 그대로 사용할 수 있습니다.",
    { retry: Boolean(state.resultBlob) },
  );
}

function setStep(step) {
  document.querySelectorAll(".step-indicator span").forEach((element, index) => {
    element.classList.toggle("is-active", index + 1 === step);
  });
}

async function takePhoto() {
  if (!getSource() || state.captureInProgress) return;

  const captureId = state.captureSequence + 1;
  state.captureSequence = captureId;
  state.captureInProgress = true;
  captureButton.disabled = true;
  setStudioControlsLocked(true);
  discardCaptureRecipe();
  const timerSeconds = Number(byId("timerSelect").value);
  const sourceTypeAtStart = state.sourceType;
  const sourceTokenAtStart =
    state.sourceType === "video" ? state.stream : state.portraitUrl;

  try {
    if (timerSeconds > 0) await runCountdown(timerSeconds, captureId);
    throwIfCaptureCancelled(captureId);
    if (state.segmenter) {
      await waitForSegmentationIdle();
      throwIfCaptureCancelled(captureId);
    }
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
        ? await captureCanonicalStill(
            liveSource,
            captureFrameCanvas,
            MAX_CAPTURE_EDGE,
          )
        : snapshotSource(
            liveSource,
            captureFrameCanvas,
            MAX_CAPTURE_EDGE,
          );
    if (state.sourceType === "image") {
      state.captureMethod = "uploaded-photo";
    }
    throwIfCaptureCancelled(captureId);
    if (state.segmenter) {
      await segmentCapturedPortrait(captureSource);
    } else {
      state.captureMaskQuality = "soft";
    }
    throwIfCaptureCancelled(captureId);

    window.clearTimeout(state.resultRenderTimer);
    state.resultRenderTimer = 0;
    state.resultRenderRevision += 1;
    state.resultRenderPromise = null;
    state.resultBackgroundRequest += 1;
    state.hairStyle = "original";
    state.lookBeforeCapture = state.look;
    state.look = "crisp";
    state.captureRecipe = createCaptureRecipe();
    setResultEditorFinalized(false);
    syncResultStyleSelections();

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
      state.captureRecipe,
    );
    const blob = await canvasToBlob(exportCanvas);
    setResultBlob(blob, { awaitingFinalize: true });
    updateStyleEditStatus(
      "success",
      state.captureMethod === "sensor-photo"
        ? "센서 정지사진으로 선명하게 촬영했어요"
        : "가장 선명한 순간을 골라 촬영했어요",
      state.captureRecipe.personBounds
        ? "배경과 헤어 무드를 고른 뒤 ‘이 스타일로 완성’을 눌러 주세요."
        : "이번 사진은 헤어 무드 대신 배경과 사진 스타일을 선택해 완성해 주세요.",
    );
    setStep(3);
    await wait(240);
    throwIfCaptureCancelled(captureId);

    if (state.sourceType === "video") {
      stopCamera();
      state.cameraPausedAfterCapture = true;
    }

    await exitCameraMode({ cancelCapture: false });
    resultDialog.showModal();
  } catch (error) {
    if (error?.name === "AbortError") {
      discardCaptureRecipe();
      setStep(1);
      return;
    }
    discardCaptureRecipe();
    console.error(error);
    if (state.segmenter && getSource() && !state.maskAvailable) {
      state.staticMaskRequested = false;
      state.staticMaskAttempts = 0;
      state.lastSegmentedAt = 0;
      updateAiStatus("loading", "촬영 프레임을 다시 확인하는 중");
    }
    showToast("사진을 완성하지 못했어요. 잠시 후 다시 촬영해 주세요.");
  } finally {
    state.captureInProgress = false;
    setStudioControlsLocked(false);
    countdownElement.textContent = "";
    countdownElement.classList.remove("pop");
    cameraStage.classList.remove("is-counting");
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
    String(date.getSeconds()).padStart(2, "0"),
  ].join("");
  return `오늘-사진-${stamp}.jpg`;
}

async function downloadPhoto({ quiet = false } = {}) {
  if (state.captureRecipe && !state.resultFinalized) {
    const finalized = await finalizeCapturedResult();
    if (!finalized) return false;
  }
  if (!state.resultUrl) return false;
  const link = document.createElement("a");
  link.href = state.resultUrl;
  link.download = buildFilename();
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (!quiet) showToast("사진을 기기에 저장했어요.");
  return true;
}

async function sharePhoto() {
  if (state.captureRecipe && !state.resultFinalized) {
    const finalized = await finalizeCapturedResult();
    if (!finalized) return;
  }
  if (!state.resultBlob) return;
  const file = new File([state.resultBlob], buildFilename(), {
    type: state.resultBlob.type || "image/jpeg",
  });
  const shareData = {
    title: "오늘, 사진",
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

  const downloaded = await downloadPhoto({ quiet: true });
  if (downloaded) {
    showToast("이 브라우저에서는 사진 공유창을 열 수 없어 사진을 저장했어요.", 3800);
  }
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function openEmailApp() {
  const email = byId("emailInput").value.trim();
  if (!isValidEmail(email)) {
    byId("emailInput").focus();
    showToast("받는 분의 이메일 주소를 확인해 주세요.");
    return;
  }

  const downloaded = await downloadPhoto({ quiet: true });
  if (!downloaded) return;
  showToast("사진을 저장했어요. 메일 작성 화면에서 첨부해 주세요.", 4000);
  const subject = encodeURIComponent("파리에서 만든 인생사진");
  const body = encodeURIComponent(
    "파리에서 만든 사진을 보내요.\n\n방금 저장된 ‘오늘-사진’ 사진 파일을 이 메일에 첨부해 주세요.",
  );
  window.setTimeout(() => {
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
  }, 250);
}

async function openSmsApp() {
  const phone = byId("phoneInput").value.trim();
  const compactPhone = phone.replace(/[^\d+]/g, "");
  if (compactPhone.length < 8) {
    byId("phoneInput").focus();
    showToast("받는 분의 휴대폰 번호를 확인해 주세요.");
    return;
  }

  const downloaded = await downloadPhoto({ quiet: true });
  if (!downloaded) return;
  showToast("사진을 저장했어요. 문자 작성 화면에서 첨부해 주세요.", 4000);
  const message = encodeURIComponent(
    "파리에서 만든 인생사진을 보내요. 방금 저장된 ‘오늘-사진’ 사진을 첨부해 주세요.",
  );
  const separator = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? "&" : "?";
  window.setTimeout(() => {
    window.location.href = `sms:${compactPhone}${separator}body=${message}`;
  }, 250);
}

async function prepareRetake() {
  if (resultDialog.open) resultDialog.close();
  discardCaptureRecipe();
  setStep(1);
  cameraStage.scrollIntoView({ behavior: "auto", block: "center" });

  if (state.sourceWasCamera) {
    const fullscreenAttempt = enterCameraMode();
    const cameraAttempt = startCamera();
    const [, started] = await Promise.all([
      fullscreenAttempt,
      cameraAttempt,
    ]);
    if (!started) {
      await exitCameraMode({ cancelCapture: false });
    }
  } else {
    state.cameraPausedAfterCapture = false;
    updateCaptureReadiness();
  }
}

function closeResult() {
  if (resultDialog.open) resultDialog.close();
  discardCaptureRecipe();
  setStep(1);

  if (state.sourceWasCamera && !state.stream) {
    state.sourceType = null;
    state.maskAvailable = false;
    state.personBounds = null;
    cameraStage.classList.remove("has-source");
    captureButton.disabled = true;
    mirrorButton.disabled = true;
    switchCameraButton.disabled = true;
    updateAiStatus("fallback", "카메라 다시 연결 필요");
  }

  cameraStage.scrollIntoView({ behavior: "smooth", block: "center" });
}

function bindControls() {
  bindRealismControls();
  [byId("heroCameraButton"), byId("stageCameraButton")].forEach((button) => {
    button.addEventListener("click", startCameraExperience);
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
    button.addEventListener("click", () => {
      void selectBuiltInBackground(button);
    });
  });

  document.querySelectorAll(".look-option").forEach((button) => {
    button.addEventListener("click", () => selectLook(button));
  });
  document.querySelectorAll("[data-result-background]").forEach((button) => {
    button.addEventListener("click", () => {
      void selectResultBackground(button);
    });
  });
  document
    .querySelector("[data-result-custom-background]")
    ?.addEventListener("click", (event) => {
      selectResultCustomBackground(event.currentTarget);
    });
  document.querySelectorAll("[data-hair-style]").forEach((button) => {
    button.addEventListener("click", () => selectResultHair(button));
  });
  document.querySelectorAll("[data-result-look]").forEach((button) => {
    button.addEventListener("click", () => selectResultLook(button));
  });

  switchCameraButton.addEventListener("click", switchCamera);
  cameraSelect.addEventListener("change", selectCameraDevice);
  refreshCamerasButton.addEventListener("click", refreshConnectedCameras);
  mirrorButton.addEventListener("click", toggleMirror);
  captureButton.addEventListener("click", takePhoto);
  byId("downloadButton").addEventListener("click", () => {
    void downloadPhoto();
  });
  byId("shareButton").addEventListener("click", sharePhoto);
  byId("emailButton").addEventListener("click", openEmailApp);
  byId("smsButton").addEventListener("click", openSmsApp);
  finalizeStyleButton?.addEventListener("click", () => {
    void finalizeCapturedResult();
  });
  byId("retakeButton").addEventListener("click", prepareRetake);
  byId("resultCloseButton").addEventListener("click", closeResult);
  driveRetryButton?.addEventListener("click", () => {
    if (!state.resultFinalized && state.captureRecipe) {
      void finalizeCapturedResult();
    } else {
      void uploadPhotoToDrive({ manualRetry: true });
    }
  });
  exitCameraModeButton.addEventListener("click", () => {
    void exitCameraMode();
  });

  document.querySelectorAll(".site-nav > a[href^='#']").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelectorAll(".site-nav > a").forEach((item) => {
        item.classList.toggle("is-active", item === link);
      });
    });
  });

  resultDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeResult();
  });

  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener(
    "webkitfullscreenchange",
    handleFullscreenChange,
  );
  document.addEventListener("keydown", (event) => {
    if (
      event.key !== "Escape" ||
      resultDialog.open ||
      !state.cameraModeActive ||
      getFullscreenElement() === document.documentElement
    ) {
      return;
    }
    event.preventDefault();
    void exitCameraMode();
  });
  window.addEventListener("resize", updateCameraViewportHeight);
  window.addEventListener("orientationchange", updateCameraViewportHeight);
  window.visualViewport?.addEventListener(
    "resize",
    updateCameraViewportHeight,
  );

  window.addEventListener("pagehide", () => {
    const shouldResetCamera =
      state.sourceType === "video" && !state.cameraPausedAfterCapture;
    stopCamera();
    deactivateCameraModeUi({ restoreScroll: false });
    state.nativeFullscreenActive = false;
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
  navigator.mediaDevices?.addEventListener?.("devicechange", async () => {
    const previousCount = state.cameraDevices.length;
    const devices = await refreshCameraDevices();
    if (devices.length !== previousCount) {
      showToast(
        devices.length > previousCount
          ? "새 카메라를 찾았어요. 촬영 카메라 목록에서 선택해 주세요."
          : "카메라 연결 상태가 변경됐어요.",
      );
    }
  });
  window.addEventListener("beforeunload", () => {
    stopCamera();
    deactivateCameraModeUi({ restoreScroll: false });
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
  void checkDriveConnection();
  await refreshCameraDevices();
  try {
    await waitForImage(defaultBackground);
  } catch {
    showToast("파리 배경을 불러오지 못했어요. 페이지를 새로고침해 주세요.");
  }
  renderComposite(previewContext, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  state.renderHandle = window.requestAnimationFrame(renderLoop);
}

initialize();
