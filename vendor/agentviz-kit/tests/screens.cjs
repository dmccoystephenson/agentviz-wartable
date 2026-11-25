// screens.cjs: README stills and GIF frames, from the demo feed only.
//
//   const screens = require("../vendor/agentviz-kit/tests/screens.cjs");
//   await screens.still(page, "docs/media/hero.png", () => drawFrame());
//   await screens.frames(page, dir, 60, (i) => stepAndDraw(i));
//   screens.gif(dir, "docs/media/demo.gif", 10);       // kit/tests/make_gif.py, Pillow
"use strict";
const {execFileSync} = require("child_process");
const fs = require("fs");
const path = require("path");
const {shot} = require("./harness.cjs");

// Labels that newly fit show on the next placement (StrataKit.placeLabels'
// 200 ms hysteresis), so a still draws three times with pauses between.
async function still(page, file, draw, pauses = [400, 400, 200]) {
  for (const ms of pauses) {
    await page.evaluate(draw);
    await page.waitForTimeout(ms);
  }
  const png = await shot(page, file);
  console.log("saved", path.basename(file));
  return png;
}

// step(i) runs in the page and must advance scene time and draw frame i.
async function frames(page, dir, count, step) {
  fs.mkdirSync(dir, {recursive: true});
  for (let i = 0; i < count; i++) {
    await page.evaluate(step, i);
    await shot(page, path.join(dir, String(i).padStart(4, "0") + ".png"));
  }
}

function gif(dir, out, fps, width = 720) {
  execFileSync("python3", [path.join(__dirname, "make_gif.py"), dir, out, String(fps), String(width)], {stdio: "inherit"});
}

module.exports = {still, frames, gif};
