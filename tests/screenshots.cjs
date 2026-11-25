// Regenerates every README image in docs/media/ from the DEMO feed (never live):
//   npm run screenshots [-- name ...]
// Stills are drawn with ?drive=1 (the kit draws one frame on demand at a given
// scene time), so they repeat. The GIF steps scene time frame by frame while
// pushing two scripted changes (a scout making camp, a new tool call) and is
// encoded with Pillow (tests/make_gif.py: a palette per frame).
const {execFileSync} = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const h = require("../vendor/agentviz-kit/tests/harness.cjs");
const screens = require("../vendor/agentviz-kit/tests/screens.cjs");

const REPO = path.resolve(__dirname, "..");
const MEDIA = path.join(REPO, "docs/media");
const PORT = Number(process.env.WARTABLE_TEST_PORT || 9134);
const READY = "window.__page && window.__page.polls > 0 && window.__table.banners.length > 0";
const only = new Set(process.argv.slice(2));
const want = (name) => only.size === 0 || only.has(name);
const DESKTOP = {viewport: {width: 1600, height: 900}};
const PHONE = {viewport: {width: 390, height: 844}, dpr: 3, mobile: true};

// Camera helpers run in the page: frame a banner or scout by id, or the whole table.
const HELPERS = `
window.__shots = {
  t: 6.3,
  settle() { for (let t = 0.5; t <= 6; t += 0.5) window.__page.kit.drive(t); },
  cam(c) { Object.assign(window.__page.kit.cam, c); },
  home(c) { window.__page.fit(true); this.cam(c || {}); },
  at(id, c) { const o = window.__page.byId(id);
    this.cam(Object.assign({yaw: Math.PI / 2, tx: o.x + (c.dx || 0), ty: c.ty || 0.6, tz: o.z + (c.dz || 0)}, c)); },
  between(a, b, c) { const p = window.__page.byId(a), q = window.__page.byId(b);
    this.cam(Object.assign({yaw: Math.PI / 2, tx: (p.x + q.x) / 2, ty: 0.6, tz: (p.z + q.z) / 2}, c)); },
  // Look at id from the side away from \`from\`, so that one is not in the way.
  away(id, from, c) { const o = window.__page.byId(id), f = window.__page.byId(from);
    this.at(id, Object.assign({yaw: Math.atan2(o.z - f.z, o.x - f.x) + (c.turn || 0)}, c)); },
  draw() { window.__page.kit.drive(window.__shots.t); },
};`;

async function openPage(browser, server, options) {
  const opened = await h.open(browser, `${server.base}/?fixture=1&drive=1`, Object.assign({ready: READY}, options));
  await h.stillAnimations(opened.page);
  await opened.page.evaluate(() => window.__page.stopPolling());
  await opened.page.evaluate(HELPERS);
  await opened.page.evaluate(() => window.__shots.settle());
  return opened;
}

async function shoot(page, name, setup) {
  if (!want(name)) return;
  await page.evaluate(setup);
  await screens.still(page, path.join(MEDIA, name + ".png"), () => window.__shots.draw());
}

const DESKTOP_SHOTS = [
  ["hero", "window.__page.select(null); window.__shots.home()"],
  ["angle-low", "window.__shots.home(); window.__shots.cam({yaw: Math.PI / 2 + 0.9, pitch: 0.42, dist: window.__page.kit.cam.dist * 1.0})"],
  ["angle-top", "window.__shots.home(); window.__shots.cam({pitch: 1.42, dist: window.__page.kit.cam.dist * 1.05})"],
  ["closeup-lead", "window.__shots.at('demo-lead-b', {yaw: Math.PI / 2 + 0.25, pitch: 0.7, dist: 13})"],
  ["closeup-waiting", "window.__shots.away('demo-waiting', 'demo-stalled', {turn: 0.5, pitch: 0.5, dist: 10, dx: -0.6, ty: 1.2})"],
  ["closeup-question", "window.__shots.at('demo-asker', {yaw: Math.PI / 2 - 0.2, pitch: 0.5, dist: 11, dx: -0.6, ty: 1.4})"],
  ["closeup-idle-offline", "window.__shots.between('demo-idle', 'demo-offline-2', {pitch: 0.6, dist: 10, ty: 0.8})"],
  ["closeup-resting", "window.__shots.away('demo-lead-a/demo-a5', 'demo-lead-a', {pitch: 0.6, dist: 6, ty: 0.3})"],
  ["closeup-stalled-scout", "window.__shots.away('demo-lead-b/demo-b7', 'demo-lead-b', {pitch: 0.55, dist: 6.5, ty: 0.6})"],
  ["closeup-actions", "window.__shots.between('demo-solo', 'demo-thinker', {pitch: 0.6, dist: 11, ty: 0.8})"],
  ["panel-desktop", "window.__shots.at('demo-lead-b', {pitch: 0.8, dist: 18, dx: 2}); window.__page.select('demo-lead-b', false)"],
  ["panel-scout", "window.__shots.at('demo-lead-b/demo-b6', {pitch: 0.7, dist: 10, dx: 1.5}); window.__page.select('demo-lead-b/demo-b6', false)"],
];

async function desktopStills(browser, server) {
  const {ctx, page, errors} = await openPage(browser, server, DESKTOP);
  for (const [name, setup] of DESKTOP_SHOTS) await shoot(page, name, setup);
  h.assertNoErrors(errors);
  await ctx.close();
}

async function phone(browser, server) {
  if (!want("phone")) return;
  const {ctx, page, errors} = await openPage(browser, server, PHONE);
  await shoot(page, "phone",
    "window.__shots.away('demo-waiting', 'demo-stalled', {turn: 0.5, pitch: 0.75, dist: 15, dx: -0.6}); window.__page.select('demo-waiting', false)");
  h.assertNoErrors(errors);
  await ctx.close();
}

// The GIF: Wren's camp for five seconds at 10 frames a second. Early on one
// scout finishes and rides out to make camp; mid-clip Wren makes a tool call
// and its finial flashes.
async function motionGif(browser, server) {
  if (!want("motion")) return;
  const {ctx, page, errors} = await openPage(browser, server, {viewport: {width: 960, height: 540}});
  await page.evaluate(() => {
    const base = JSON.parse(JSON.stringify(window.__page.doc));
    const wren = base.sessions.find((s) => s.id === "demo-lead-a");
    window.__gif = {
      camp() { Object.assign(wren.followers.find((f) => f.id === "demo-a1"), {state: "resting", action: "none"});
        window.__page.feed(JSON.parse(JSON.stringify(base))); },
      toolCall() { wren.lastToolAt += 30; window.__page.feed(JSON.parse(JSON.stringify(base))); },
    };
    for (let t = 6.5; t <= 10; t += 0.5) window.__page.kit.drive(t);
    window.__shots.at("demo-lead-a", {yaw: Math.PI / 2 + 0.15, pitch: 0.72, dist: 11.5, dx: -0.3});
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wartable-gif-"));
  const FPS = 10;
  await screens.frames(page, tmp, FPS * 5, (i) => {
    const t = 10 + i / 10;
    if (i === 3) { window.__page.kit.drive(t); window.__gif.camp(); }
    if (i === 25) { window.__page.kit.drive(t); window.__gif.toolCall(); }
    window.__page.kit.drive(t);
  });
  execFileSync("python3", [path.join(__dirname, "make_gif.py"), tmp, path.join(MEDIA, "motion.gif"), String(FPS), "800"],
    {stdio: "inherit"});
  fs.rmSync(tmp, {recursive: true, force: true});
  h.assertNoErrors(errors);
  await ctx.close();
}

h.run("screenshots", {repo: REPO, port: PORT}, async ({server, browser}) => {
  fs.mkdirSync(MEDIA, {recursive: true});
  await desktopStills(browser, server);
  await phone(browser, server);
  await motionGif(browser, server);
});
