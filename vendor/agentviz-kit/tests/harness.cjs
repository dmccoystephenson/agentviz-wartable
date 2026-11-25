// harness.cjs: what every agentviz browser test needs (docs/KIT.md, "Tests").
//
//   const h = require("../vendor/agentviz-kit/tests/harness.cjs");
//   const server = await h.serveFixture({repo, port: 8941});   // the demo feed, never live
//   const browser = await h.launch();
//   const {page, errors} = await h.open(browser, server.base + "/?fixture=1&drive=1", {ready: "window.__page"});
//   await h.stillAnimations(page);
//   const png = await h.shot(page, "out.png");
//   await h.assertNotFlat(page, png);
//   h.assertNoErrors(errors);
//   await browser.close(); server.stop();
//
// Playwright comes from NODE_PATH or the repo's ./node_modules (`npm ci`);
// nothing else is searched. Chromium runs SwiftShader, which is far slower
// than a GPU: never judge performance from it.
"use strict";
const {spawn} = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const LAUNCH_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const STARTUP_MS = 15000;

function loadPlaywright(repo = process.cwd()) {
  const local = path.join(repo, "node_modules", "playwright");
  for (const name of ["playwright", local]) {
    try {
      return require(name);
    } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") throw error;
    }
  }
  throw new Error("Playwright not found. Run `npm ci` (or `npm i playwright && npx playwright install chromium`) " +
    "in the repo, or set NODE_PATH to a node_modules that has it.");
}

function status(url) {
  return new Promise((resolve) => {
    http.get(url, (r) => { r.resume(); resolve(r.statusCode); }).on("error", () => resolve(0));
  });
}

// Starts `python3 -m vendor.agentfeed serve --fixture` and waits for the feed.
// stop() kills exactly that process, by its pid.
async function serveFixture({repo = process.cwd(), port, web = "web", python = "python3"}) {
  if (!port) throw new Error("serveFixture: pass the test port");
  const child = spawn(python, ["-m", "vendor.agentfeed", "serve", "--web", web, "--port", String(port), "--fixture"],
    {cwd: repo, stdio: ["ignore", "ignore", "inherit"]});
  let exited = null;
  child.on("exit", (code) => { exited = code; });
  const base = `http://127.0.0.1:${port}`;
  const stop = () => { if (exited === null) process.kill(child.pid); };
  const deadline = Date.now() + STARTUP_MS;
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`fixture server exited (${exited}); is port ${port} free?`);
    if (await status(base + "/api/agents") === 200) return {base, pid: child.pid, stop};
    await new Promise((r) => setTimeout(r, 100));
  }
  stop();
  throw new Error(`fixture server did not answer on ${base} within ${STARTUP_MS} ms`);
}

async function launch(repo) {
  return loadPlaywright(repo).chromium.launch({args: LAUNCH_ARGS});
}

// Opens url in a fresh context and waits for `ready` (a JS expression that
// is truthy once the page has drawn). Console errors and page errors are
// collected in `errors`.
async function open(browser, url, {viewport = {width: 1280, height: 760}, dpr = 1, mobile = false,
  ready = "true", timeout = 400000} = {}) {
  const ctx = await browser.newContext({viewport, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile});
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url, {waitUntil: "commit"});
  await page.waitForFunction(ready, null, {timeout});
  return {ctx, page, errors};
}

// CSS animations (the pulsing "needs you" chip) keep headless SwiftShader
// compositing forever, which stalls screenshots. Real browsers are fine.
async function stillAnimations(page) {
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = "*{animation:none!important;transition:none!important}";
    document.head.appendChild(style);
  });
}

// Under ?drive=1 the kit's loop is off: draw scene time t synchronously.
async function drive(page, t) {
  await page.evaluate((time) => window.__strataKit.drive(time), t);
}

// The DevTools capture reads what is on screen now; page.screenshot waits
// for a stable page, which a slow WebGL page may never be.
async function shot(page, file) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const {data} = await cdp.send("Page.captureScreenshot", {format: "png"});
    const png = Buffer.from(data, "base64");
    if (file) {
      fs.mkdirSync(path.dirname(file), {recursive: true});
      fs.writeFileSync(file, png);
    }
    return png;
  } finally {
    await cdp.detach();
  }
}

// Distinct colours (4 bits a channel) in a sample of the PNG's pixels.
async function colourCount(page, png) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
    return seen.size;
  }, png.toString("base64"));
}

async function assertNotFlat(page, png, minColours = 30) {
  const colours = await colourCount(page, png);
  if (colours < minColours) throw new Error(`frame looks flat: ${colours} colours (want >= ${minColours})`);
  return colours;
}

function assertNoErrors(errors) {
  if (errors.length) throw new Error("console errors:\n" + errors.join("\n"));
}

// Runs an async test body with a server and a browser, cleans both up, and
// sets the exit code. body({server, browser}) throws to fail.
async function run(name, {repo = process.cwd(), port}, body) {
  let server = null, browser = null, ok = false;
  try {
    server = await serveFixture({repo, port});
    browser = await launch(repo);
    await body({server, browser});
    ok = true;
    console.log(`${name}: PASS`);
  } catch (error) {
    console.error(`${name}: FAIL`, error.message);
  } finally {
    if (browser) await browser.close();
    if (server) server.stop();
  }
  process.exitCode = ok ? 0 : 1;
}

module.exports = {loadPlaywright, serveFixture, launch, open, stillAnimations, drive, shot, colourCount,
  assertNotFlat, assertNoErrors, run, LAUNCH_ARGS};
