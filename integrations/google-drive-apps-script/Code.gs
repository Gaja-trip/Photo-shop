const DEFAULT_TARGET_FOLDER_ID = "1T9pwEsFZaNMPB8GldEg6NGPXoggxUdnG";
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_AGE_MS = 5 * 60 * 1000;

function jsonOutput_(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function base64Url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, "");
}

function constantTimeEqual_(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  var mismatch = left.length ^ right.length;
  var length = Math.max(left.length, right.length);
  for (var index = 0; index < length; index += 1) {
    mismatch |=
      (left.charCodeAt(index % Math.max(1, left.length)) || 0) ^
      (right.charCodeAt(index % Math.max(1, right.length)) || 0);
  }
  return mismatch === 0;
}

function safeFilename_(value) {
  var sanitized = String(value || "오늘-사진.jpg")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 100);
  var stem = sanitized.replace(/\.(jpe?g)$/i, "") || "오늘-사진";
  return stem + ".jpg";
}

function storedFilename_(filename, uploadId) {
  var stem = safeFilename_(filename).replace(/\.jpg$/i, "");
  return stem + "-" + uploadId.slice(0, 12) + ".jpg";
}

function doGet() {
  return jsonOutput_({
    ok: true,
    service: "오늘, 사진 Google Drive upload",
  });
}

function doPost(event) {
  var properties = PropertiesService.getScriptProperties();
  var secret = properties.getProperty("UPLOAD_HMAC_SECRET");
  var folderId =
    properties.getProperty("TARGET_FOLDER_ID") || DEFAULT_TARGET_FOLDER_ID;
  if (!secret || secret.length < 32) {
    return jsonOutput_({ ok: false, code: "SCRIPT_NOT_CONFIGURED" });
  }

  try {
    var outer = JSON.parse(event.postData.contents || "{}");
    var payloadText = outer.payload;
    var suppliedSignature = outer.signature;
    if (
      typeof payloadText !== "string" ||
      typeof suppliedSignature !== "string"
    ) {
      return jsonOutput_({ ok: false, code: "INVALID_REQUEST" });
    }

    var expectedSignature = base64Url_(
      Utilities.computeHmacSha256Signature(
        payloadText,
        secret,
        Utilities.Charset.UTF_8,
      ),
    );
    if (!constantTimeEqual_(expectedSignature, suppliedSignature)) {
      return jsonOutput_({ ok: false, code: "INVALID_SIGNATURE" });
    }

    var payload = JSON.parse(payloadText);
    if (
      !Number.isFinite(payload.timestamp) ||
      Math.abs(Date.now() - payload.timestamp) > MAX_REQUEST_AGE_MS ||
      !/^[a-zA-Z0-9-]{16,96}$/.test(payload.uploadId || "") ||
      payload.mimeType !== "image/jpeg" ||
      typeof payload.data !== "string"
    ) {
      return jsonOutput_({ ok: false, code: "INVALID_PAYLOAD" });
    }

    var bytes = Utilities.base64Decode(payload.data);
    if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) {
      return jsonOutput_({ ok: false, code: "PHOTO_TOO_LARGE" });
    }

    var filename = storedFilename_(payload.filename, payload.uploadId);
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var folder = DriveApp.getFolderById(folderId);
      var existingFiles = folder.getFilesByName(filename);
      var file;
      if (existingFiles.hasNext()) {
        file = existingFiles.next();
      } else {
        var blob = Utilities.newBlob(bytes, "image/jpeg", filename);
        file = folder.createFile(blob);
        file.setDescription(
          "오늘, 사진 자동 저장\nUpload ID: " + payload.uploadId,
        );
      }

      return jsonOutput_({
        ok: true,
        id: file.getId(),
        name: file.getName(),
        url: file.getUrl(),
      });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error);
    return jsonOutput_({ ok: false, code: "UPLOAD_FAILED" });
  }
}
