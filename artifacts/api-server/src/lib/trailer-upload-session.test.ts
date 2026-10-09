import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CHUNK_BYTES, SESSION_LIFETIME_SECONDS, bunnyTusSignature, openTrailerSession, sealTrailerSession, tusMetadata, validateChunk,
  type TrailerUploadSession,
} from "./trailer-upload-session";

process.env.SESSION_SECRET ??= "trailer-upload-test-secret";
const now = Date.now();
const session = (): TrailerUploadSession => ({
  videoId: "0b0e3f7a-1c2d-4e5f-8a9b-0c1d2e3f4a5b", tusUrl: "https://video.bunnycdn.com/tusupload/abc",
  size: 37_100_000, type: "video/mp4", filename: "demo.mp4", ownerKey: "draft:visitor:7",
  expire: Math.floor(now / 1000) + SESSION_LIFETIME_SECONDS,
});

test("a sealed session opens only for its owner and hides the upload URL", () => {
  const token = sealTrailerSession(session());
  assert.deepEqual(openTrailerSession(token, "draft:visitor:7", now), session());
  assert.equal(openTrailerSession(token, "draft:visitor:8", now), null);
  assert.equal(Buffer.from(token, "base64url").toString("latin1").includes("tusupload"), false);
});

test("tampered, truncated, malformed or expired tokens are rejected", () => {
  const token = sealTrailerSession(session());
  const raw = Buffer.from(token, "base64url"); raw[raw.length - 1] ^= 1;
  assert.equal(openTrailerSession(raw.toString("base64url"), "draft:visitor:7", now), null);
  assert.equal(openTrailerSession(token.slice(0, 20), "draft:visitor:7", now), null);
  assert.equal(openTrailerSession("not a token!", "draft:visitor:7", now), null);
  assert.equal(openTrailerSession(undefined, "draft:visitor:7", now), null);
  assert.equal(openTrailerSession(token, "draft:visitor:7", now + (SESSION_LIFETIME_SECONDS + 1) * 1000), null);
});

test("Bunny TUS signature is SHA256 of library, key, expiry and video id", () => {
  const expected = createHash("sha256").update("123secret1700000000vid").digest("hex");
  assert.equal(bunnyTusSignature("123", "secret", 1700000000, "vid"), expected);
});

test("pieces must fit the declared size and the 16 MB limit", () => {
  const s = { size: CHUNK_BYTES * 2 + 5 };
  assert.equal(validateChunk(s, 0, CHUNK_BYTES), null);
  assert.equal(validateChunk(s, CHUNK_BYTES * 2, 5), null);
  assert.match(validateChunk(s, 0, CHUNK_BYTES + 1)!, /16 MB/);
  assert.match(validateChunk(s, CHUNK_BYTES * 2, 6)!, /past the declared/);
  assert.match(validateChunk(s, -1, 5)!, /offset/);
  assert.match(validateChunk(s, 0, 0)!, /empty/);
});

test("TUS metadata encodes values in base64 and skips empty ones", () => {
  assert.equal(tusMetadata({ filetype: "video/mp4", title: "Démo", collection: "" }),
    `filetype ${Buffer.from("video/mp4").toString("base64")},title ${Buffer.from("Démo").toString("base64")}`);
});
