import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUpdateEmail, increaseUrl, BUTTON_LABEL, FOOTER_LINE, RISK_LINE } from "./project-update-email-content";

const content = {
  projectTitle: "Night Shift", milestone: "Team member joined", role: "Director", personName: "Ava Lee",
  note: "We found our director.", pledgeAmount: 250, buttonUrl: "https://example.com/project/night-shift?increase=7",
  turnOffUrl: "https://example.com/api/update-emails/off?i=3&t=abc",
};

test("every email has a one-click way to turn update emails off", () => {
  const email = buildUpdateEmail(content);
  assert.ok(email.text.includes("Turn off update emails: https://example.com/api/update-emails/off?i=3&t=abc"));
  assert.ok(email.html.includes('href="https://example.com/api/update-emails/off?i=3&amp;t=abc"'));
});

test("the email carries the project, milestone, approved note and the backer's own pledge with the risk line beside it", () => {
  const email = buildUpdateEmail(content);
  assert.equal(email.subject, "Night Shift: Team member joined (Director: Ava Lee)");
  assert.match(email.text, /Night Shift has a new update: Team member joined \(Director: Ava Lee\)\./);
  assert.match(email.text, /We found our director\./);
  assert.ok(email.text.includes(`Your confirmed non-binding pledge to this project: $250. ${RISK_LINE}`));
});

test("there is exactly one button, Increase my pledge", () => {
  const email = buildUpdateEmail(content);
  // One button-styled link; the only other link is the plain "Turn off update emails".
  assert.equal((email.html.match(/<a [^>]*background:/g) ?? []).length, 1);
  assert.equal((email.html.match(/<a /g) ?? []).length, 2);
  assert.ok(email.html.includes(`>${BUTTON_LABEL}</a>`));
  for (const banned of [/still in/i, /step back/i, /withdraw/i, /re-?confirm/i]) {
    assert.doesNotMatch(email.text, banned);
    assert.doesNotMatch(email.html, banned);
  }
});

test("the email ends with the required footer and never names The AYeList or calls payback a return", () => {
  const email = buildUpdateEmail(content);
  assert.ok(email.text.endsWith(FOOTER_LINE));
  assert.ok(email.html.endsWith(`${FOOTER_LINE}</p>`));
  assert.doesNotMatch(email.text + email.html, /AYeList/i);
  assert.doesNotMatch(email.text.replace(RISK_LINE, ""), /\breturns?\b|earnings|expect/i);
});

test("the button links to the project page with the update marker and no login token", () => {
  assert.equal(increaseUrl("https://movieshowinvesting.com/", "night-shift", 7), "https://movieshowinvesting.com/project/night-shift?increase=7");
  assert.equal(increaseUrl(undefined, "night-shift", 7), null);
  assert.equal(increaseUrl("https://user:pw@example.com", "x", 1), null);
});

test("an update without a note or named person still reads cleanly", () => {
  const email = buildUpdateEmail({ ...content, role: null, personName: null, note: null, milestone: "Filming started" });
  assert.equal(email.subject, "Night Shift: Filming started");
  assert.doesNotMatch(email.text, /\n\n\n/);
});
