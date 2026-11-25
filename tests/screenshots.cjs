// Regenerates every README image in docs/media/ from the FIXTURE feed.
//
//   python3 -m vendor.agentfeed serve --web web --port 8950 --fixture &
//   NODE_PATH=/root/arcade-watch/node_modules node tests/screenshots.cjs [url] [only]
//
// Stills use ?drive=1 so scene time is fixed and frames repeat; the GIF steps
// scene time at 10 fps and is assembled with Pillow (python3). Never point
// this at a live feed: README images must show the demo feed only.
"use strict";
const {chromium} = require("playwright");
const fs = require("fs");
const path = require("path");
const {execFileSync} = require("child_process");

const base = (process.argv[2] || "http://127.0.0.1:8950/").replace(/\/?$/, "/");
const only = process.argv[3] || "";
const media = path.join(__dirname, "..", "docs", "media");
fs.mkdirSync(media, {recursive: true});

const ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

const settle = (page, secs = 4) => page.evaluate((secs) => {
  for (let i = 0; i < secs * 10; i++) window.__wartable.frame(i / 10, 0.1);
}, secs);

async function open(browser, {width, height, dpr = 1, mobile = false}) {
  const ctx = await browser.newContext({viewport: {width, height}, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile});
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "?fixture=1&drive=1&quality=1", {waitUntil: "commit"});
  await page.waitForFunction(() => window.__strataKit && window.__strataKit.ready && window.__wartable &&
    window.__wartable.doc, null, {timeout: 120000});
  // Let the easing settle without drawing (each drawn frame is seconds of
  // SwiftShader work): advance the page's state only.
  await settle(page);
  return {ctx, page, errors};
}

// Positions of banners/scouts by id, for close-ups.
const where = (page, id) => page.evaluate((id) => {
  const w = window.__wartable, o = w.banners.get(id) || w.scouts.get(id);
  return o ? {x: o.x, z: o.z} : null;
}, id);

async function still(page, file, cam, t = 6.3, select = undefined) {
  try {
    await stillOnce(page, file, cam, t, select);
  } catch (e) {  // SwiftShader occasionally stalls one capture: try once more
    console.warn("retrying", file, String(e.message || e).split("\n")[0]);
    await stillOnce(page, file, cam, t, select);
  }
}

async function stillOnce(page, file, cam, t, select) {
  await page.evaluate(({cam, t, select}) => {
    if (select !== undefined) window.__wartableSelect(select);
    const c = window.__strataKit.cam;
    Object.assign(c, cam);
    window.__strataKit.drive(t);
  }, {cam, t, select});
  // Labels show and hide with a short hysteresis: draw again once it has passed.
  await page.waitForTimeout(450);
  await page.evaluate((t) => window.__strataKit.drive(t), t);
  await page.screenshot({path: path.join(media, file), timeout: 600000});
  console.log("wrote", file);
}

(async () => {
  const browser = await chromium.launch({args: ARGS});
  const want = (n) => !only || only.split(",").includes(n);
  try {
    {
      const {ctx, page, errors} = await open(browser, {width: 1600, height: 900});
      const home = await page.evaluate(() => Object.assign({}, window.__strataKit.cam));
      if (want("hero")) await still(page, "hero.png", home);
      if (want("angles")) {
        await still(page, "angle-low.png", Object.assign({}, home, {yaw: home.yaw + 0.9, pitch: 0.42, dist: home.dist * 0.85}));
        await still(page, "angle-top.png", Object.assign({}, home, {pitch: 1.42, dist: home.dist * 1.05}));
      }
      if (want("closeups")) {
        const otto = await where(page, "demo-lead-b");
        await still(page, "closeup-lead.png", {yaw: home.yaw + 0.25, pitch: 0.7, dist: 12, tx: otto.x, ty: 0.6, tz: otto.z});
        const thistle = await where(page, "demo-waiting");
        await still(page, "closeup-waiting.png", {yaw: home.yaw + 0.2, pitch: 0.55, dist: 8, tx: thistle.x - 0.6, ty: 1, tz: thistle.z});
        const lantern = await where(page, "demo-idle"), tally = await where(page, "demo-offline-2");
        await still(page, "closeup-idle-offline.png", {yaw: home.yaw, pitch: 0.6, dist: 9,
          tx: (lantern.x + tally.x) / 2, ty: 0.8, tz: (lantern.z + tally.z) / 2});
        const rest = await where(page, "demo-lead-a/demo-a5");
        await still(page, "closeup-resting.png", {yaw: home.yaw - 0.3, pitch: 0.6, dist: 5.5, tx: rest.x, ty: 0.3, tz: rest.z});
        const anvil = await where(page, "demo-solo");
        await still(page, "closeup-actions.png", {yaw: home.yaw + 0.1, pitch: 0.6, dist: 11, tx: anvil.x, ty: 0.8, tz: anvil.z});
      }
      if (want("panel")) {
        const wren = await where(page, "demo-lead-a");
        await still(page, "panel-desktop.png", {yaw: home.yaw, pitch: 0.8, dist: 18, tx: wren.x + 2, ty: 0, tz: wren.z}, 6.3,
          "demo-lead-a");
        await page.evaluate(() => window.__wartableSelect(null));
      }
      if (want("gif")) {
        const wren = await where(page, "demo-lead-a");
        const frames = path.join(media, ".frames");
        fs.rmSync(frames, {recursive: true, force: true});
        fs.mkdirSync(frames);
        await page.setViewportSize({width: 800, height: 450});
        await page.evaluate((c) => Object.assign(window.__strataKit.cam, c),
          {yaw: home.yaw + 0.15, pitch: 0.72, dist: 15, tx: wren.x, ty: 0.5, tz: wren.z});
        for (let i = 0; i < 50; i++) {
          const t = 10 + i / 10;
          await page.evaluate((t) => window.__strataKit.drive(t), t);
          await page.screenshot({path: path.join(frames, String(i).padStart(3, "0") + ".png"), timeout: 600000});
        }
        execFileSync("python3", ["-I", "-c", [
          "import sys, glob", "from PIL import Image",
          "fs = sorted(glob.glob(sys.argv[1] + '/*.png'))",
          "ims = [Image.open(f).convert('RGB').quantize(colors=160, method=Image.Quantize.MEDIANCUT) for f in fs]",
          "ims[0].save(sys.argv[2], save_all=True, append_images=ims[1:], duration=100, loop=0, optimize=True)",
        ].join("\n"), frames, path.join(media, "motion.gif")]);
        fs.rmSync(frames, {recursive: true, force: true});
        console.log("wrote motion.gif");
      }
      if (errors.length) { console.error("console errors:", errors); process.exitCode = 1; }
      await ctx.close();
    }
    if (want("phone")) {
      const {ctx, page, errors} = await open(browser, {width: 390, height: 844, dpr: 3, mobile: true});
      const thistle = await where(page, "demo-waiting");
      await still(page, "phone.png", {pitch: 0.85, dist: 15, tx: thistle.x, ty: 0, tz: thistle.z + 2.5}, 6.3, "demo-waiting");
      if (errors.length) { console.error("console errors:", errors); process.exitCode = 1; }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
