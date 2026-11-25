// Headless browser smoke test: serves the fixture, loads /?fixture=1, waits
// for the kit to draw, checks the frame is not one flat colour, a banner can
// be tapped and the panel opens, and no console errors; saves
// docs/media/screenshot.png.
//
//   NODE_PATH=/root/arcade-watch/node_modules node tests/smoke.cjs [port]
"use strict";
const {chromium} = require("playwright");
const {spawn} = require("child_process");
const path = require("path");
const http = require("http");

const root = path.join(__dirname, "..");
const port = Number(process.argv[2] || 8950);
const url = `http://127.0.0.1:${port}/?fixture=1`;

function waitFor(u, ms) {
  const end = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => http.get(u, (r) => { r.resume(); resolve(); }).on("error", () =>
      Date.now() > end ? reject(new Error("server did not start")) : setTimeout(tick, 200));
    tick();
  });
}

(async () => {
  const server = spawn("python3", ["-m", "vendor.agentfeed", "serve", "--web", "web", "--port", String(port), "--fixture"],
    {cwd: root, stdio: "ignore"});
  let browser;
  try {
    await waitFor(`http://127.0.0.1:${port}/api/agents`, 10000);
    browser = await chromium.launch({args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist"]});
    const page = await browser.newPage({viewport: {width: 1280, height: 720}});
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(url, {waitUntil: "commit"});
    await page.waitForFunction(() => window.__strataKit && window.__strataKit.ready && window.__wartable &&
      window.__wartable.doc && window.__strataKit.stats().frames > 3, null, {timeout: 120000});
    const info = await page.evaluate(() => {
      const w = window.__wartable;
      return {banners: w.banners.size, scouts: w.scouts.size, stats: window.__strataKit.stats()};
    });
    console.log("drawn:", JSON.stringify(info));
    if (info.banners !== 8) throw new Error("expected 8 banners, got " + info.banners);
    if (info.scouts !== 11) throw new Error("expected 11 scouts, got " + info.scouts);
    if (!(info.stats.primitives > 100)) throw new Error("too few primitives drawn");
    // The frame is not one flat colour.
    const flat = await page.evaluate(() => {
      const c = document.getElementById("view");
      const g = document.createElement("canvas");
      g.width = 64; g.height = 36;
      const x = g.getContext("2d");
      x.drawImage(c, 0, 0, 64, 36);
      const d = x.getImageData(0, 0, 64, 36).data;
      let min = 255, max = 0;
      for (let i = 0; i < d.length; i += 4) { const l = d[i] + d[i + 1] + d[i + 2]; min = Math.min(min, l); max = Math.max(max, l); }
      return max - min < 30;
    });
    if (flat) throw new Error("frame is one flat colour");
    // A tap on a banner's target selects it and opens the panel.
    const target = await page.evaluate(() => window.__strataKit.targets()[0]);
    if (!target) throw new Error("no tap targets");
    const picked = await page.evaluate((t) => window.__strataKit.tapAt(t.x, t.y), target);
    if (!picked) throw new Error("tap at a target picked nothing");
    await page.waitForFunction(() => !document.getElementById("sheet").hidden, null, {timeout: 10000});
    await page.evaluate(() => window.__wartableSelect(null));
    await page.waitForTimeout(1500);
    await page.screenshot({path: path.join(root, "docs", "media", "screenshot.png"), timeout: 180000});
    if (errors.length) throw new Error("console errors:\n" + errors.join("\n"));
    console.log("smoke: PASS");
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => { console.error("smoke: FAIL", e.message || e); process.exit(1); });
