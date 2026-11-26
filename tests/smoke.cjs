// Headless smoke test on the demo feed (vendor/agentviz-kit/tests/harness.cjs):
// every fixture session is a banner, every subagent a scout, every place a region;
// the "needs you" chip cycles the waiting sessions; a tap on a waiting banner
// opens its panel, which says why it waits; a stalled subagent is marked; a
// subagent on its own branch shows it in the panel; a new tool call pulses;
// feed strings never become HTML; the empty state and the unreachable banner
// show; the frame is not flat; no console errors. Saves docs/media/screenshot.png.
//   npm ci && npx playwright install chromium && npm run smoke
// Every expected count and name is read from the feed document, not hardcoded.
const path = require("path");
const h = require("../vendor/agentviz-kit/tests/harness.cjs");

const REPO = path.resolve(__dirname, "..");
const PORT = Number(process.env.WARTABLE_TEST_PORT || 9134);
const READY = "window.__page && window.__page.polls > 0 && window.__table.banners.length > 0";

function check(cond, message) { if (!cond) throw new Error(message); }

async function checkScene(page) {
  const info = await page.evaluate(() => {
    const t = window.__table, doc = window.__page.doc;
    return {banners: t.banners.length, scouts: t.scouts.length, regions: t.regions.length,
      want: {banners: doc.sessions.length, scouts: doc.sessions.reduce((n, s) => n + s.followers.length, 0),
        regions: new Set(doc.sessions.map((s) => s.place)).size},
      waiting: doc.sessions.filter((s) => s.state === "waiting").map((s) => s.name),
      primitives: window.__page.kit.stats().primitives};
  });
  console.log("scene:", JSON.stringify(info));
  check(info.banners === info.want.banners && info.scouts === info.want.scouts && info.regions === info.want.regions,
    "the table does not hold every fixture session, subagent and place");
  check(info.waiting.length === 2, "the fixture should have two sessions waiting");
  check(info.primitives > 200, "too few primitives drawn");
  return info;
}

const panelTitle = (page) => page.evaluate(() => {
  const panel = document.querySelector(".av-panel");
  return panel.hidden ? null : panel.querySelector("h2").textContent.trim();
});
const panelValues = (page) => page.evaluate(() => [...document.querySelectorAll(".av-panel dd")].map((d) => d.textContent));

async function checkWaitingChip(page, names) {
  const chip = page.locator(".av-wait");
  check(await chip.isVisible(), "the needs-you chip is hidden");
  check((await chip.locator("b").textContent()) === String(names.length), "the needs-you chip miscounts");
  const seen = [];
  for (let i = 0; i < names.length; i++) { await chip.click(); seen.push(await panelTitle(page)); }
  console.log("needs-you chip cycles:", seen.join(" -> "));
  check(seen.slice().sort().join() === names.slice().sort().join(), "the chip did not cycle both waiting sessions");
  check(await page.locator(".av-panel .av-needs").isVisible(), "the panel does not say why it waits");
}

async function checkTapOnWaiting(page) {
  const want = await page.evaluate(() => {
    window.__page.select(null);
    window.__page.fit(true);
    window.__page.kit.drive(1);
    const s = window.__page.doc.sessions.find((x) => x.state === "waiting" && x.waitingReason === "permission");
    return {id: s.id, name: s.name};
  });
  const hit = await page.evaluate((id) => window.__strataKit.targets().find((t) => t.id === id), want.id);
  check(hit, "no tap target for " + want.name);
  await page.mouse.click(hit.x, hit.y);
  await page.waitForTimeout(300);
  const title = await panelTitle(page);
  const reason = await page.evaluate(() => document.querySelector(".av-panel .av-needs").textContent);
  console.log("tap on the waiting banner:", title, "/", reason);
  check(title === want.name && reason === "needs permission", "the tap did not open the waiting panel with its reason");
}

async function checkFollowers(page) {
  const found = await page.evaluate(() => {
    const doc = window.__page.doc, key = (s, f) => s.id + "/" + f.id;
    let stalled = null, branched = null;
    for (const s of doc.sessions) for (const f of s.followers) {
      if (f.stalled && !stalled) stalled = {id: key(s, f), label: f.label};
      if (f.branch && f.branch !== s.branch && !branched) branched = {id: key(s, f), branch: f.branch};
    }
    return {stalled, branched};
  });
  check(found.stalled && found.branched, "the fixture should have a stalled subagent and one on its own branch");
  await page.evaluate(() => window.__page.kit.drive(1.2));
  const marked = await page.evaluate((label) => [...document.querySelectorAll(".av-label.scout.stalled")]
    .some((el) => el.textContent === label + " \u00b7 stalled"), found.stalled.label);
  check(marked, "the stalled subagent's scout label is not marked stalled");
  await page.evaluate((id) => window.__page.select(id, false), found.stalled.id);
  check(await page.locator(".av-panel .av-dot.av-s-stalled").count() > 0, "the stalled subagent's panel does not say so");
  await page.evaluate((id) => window.__page.select(id, false), found.branched.id);
  const values = await panelValues(page);
  console.log("subagent on its own branch:", found.branched.branch);
  check(values.includes(found.branched.branch), "the subagent panel does not show its own branch");
}

async function checkToolCallPulse(page) {
  const pulse = await page.evaluate(() => {
    const doc = JSON.parse(JSON.stringify(window.__page.doc));
    const s = doc.sessions.find((x) => x.state === "busy" && x.lastToolAt != null);
    s.lastToolAt += 5;
    window.__page.feed(doc);
    return window.__page.feedClient.pulse(s.id);
  });
  check(pulse > 0.5, "a new tool call did not pulse its banner");
}

async function checkTextOnly(page) {
  const result = await page.evaluate(() => {
    const doc = JSON.parse(JSON.stringify(window.__page.doc));
    const lead = doc.sessions.find((s) => s.followers.length > 0);
    lead.followers[0].label = "<img src=x id=pwned>";
    window.__page.feed(doc);
    window.__page.select(lead.id, false);
    window.__page.kit.drive(1.4);
    const isText = (el) => el.textContent.includes("<img src=x id=pwned>");
    return {img: !!document.getElementById("pwned"),
      panel: [...document.querySelectorAll(".av-panel .av-lanes button")].some(isText),
      label: [...document.querySelectorAll(".av-label.scout")].some(isText)};
  });
  check(!result.img && result.panel && result.label, "a feed label was parsed as HTML");
}

async function checkEmptyState(page) {
  const shown = await page.evaluate(() => {
    const doc = JSON.parse(JSON.stringify(window.__page.doc));
    const sessions = doc.sessions;
    window.__page.feed(Object.assign(doc, {sessions: []}));
    window.__page.kit.drive(1.5);
    const visible = !document.querySelector(".av-empty").hidden;
    window.__page.feed(Object.assign(doc, {sessions}));
    return visible && document.querySelector(".av-empty").hidden;
  });
  check(shown, "no empty-state hint with zero sessions");
}

async function checkUnreachable(page) {
  await page.route("**/api/agents*", (route) => route.fulfill({status: 503, body: "down"}));
  await page.evaluate(async () => { await window.__page.pollOnce(); await window.__page.pollOnce(); });
  const banner = await page.evaluate(() => !document.querySelector(".av-banner").hidden && document.querySelector(".av-banner").textContent);
  console.log("banner:", banner);
  check(banner && banner.includes("HTTP 503"), "no unreachable banner after failed polls");
}

h.run("smoke", {repo: REPO, port: PORT}, async ({server, browser}) => {
  const {page, errors} = await h.open(browser, server.base + "/?fixture=1&drive=1&quality=1",
    {ready: READY, viewport: {width: 1600, height: 900}});
  await h.stillAnimations(page);
  await page.evaluate(() => { window.__page.stopPolling(); window.__page.kit.drive(0.5); });
  const original = await page.evaluate(() => JSON.parse(JSON.stringify(window.__page.doc)));
  const info = await checkScene(page);
  await checkWaitingChip(page, info.waiting);
  await checkTapOnWaiting(page);
  await checkFollowers(page);
  await checkToolCallPulse(page);
  await checkTextOnly(page);
  await checkEmptyState(page);
  await page.evaluate((doc) => { window.__page.feed(doc); window.__page.select(null); window.__page.fit(true); }, original);
  await page.mouse.move(2, 400);  // no hover ring in the saved frame
  const png = await require("../vendor/agentviz-kit/tests/screens.cjs").still(page,
    path.join(REPO, "docs/media/screenshot.png"), () => window.__page.kit.drive(4));
  console.log("distinct colours:", await h.assertNotFlat(page, png));
  h.assertNoErrors(errors);
  await checkUnreachable(page);  // last: the failed fetches log console errors of their own
});
