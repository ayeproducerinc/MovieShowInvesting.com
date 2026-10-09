import { test } from "node:test";
import assert from "node:assert/strict";
import { optOutToken, optOutUrl, verifyOptOutToken } from "./update-email-preference";

const secret = "test-secret-for-update-email-links";

test("an opt-out link works only for the backer it was made for", () => {
  const token = optOutToken(42, secret);
  assert.equal(verifyOptOutToken(42, token, secret), true);
  assert.equal(verifyOptOutToken(43, token, secret), false);
  assert.equal(verifyOptOutToken(42, token, "another-secret"), false);
  assert.equal(verifyOptOutToken(42, "short", secret), false);
});

test("the opt-out link needs the app URL and the secret", () => {
  const url = optOutUrl("https://movieshowinvesting.com/", 42, secret);
  assert.ok(url?.startsWith("https://movieshowinvesting.com/api/update-emails/off?i=42&t="));
  assert.equal(optOutUrl(undefined, 42, secret), null);
  assert.equal(optOutUrl("https://movieshowinvesting.com", 42, undefined), null);
});
