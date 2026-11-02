#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const validator = path.join(__dirname, "validate-guide-contract.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "travel-date-contract-"));

function page(dates) {
  return `<!doctype html><html><body data-trip-start="${dates[0]}" data-trip-end="${dates.at(-1)}">${dates.map((date, index) => `<section class="day" id="day-${index}" data-itinerary-date="${date}"><div class="date"><small>${date}</small></div></section>`).join("")}</body></html>`;
}

function write(name, dates) {
  const file = path.join(tempDir, name);
  fs.writeFileSync(file, page(dates), "utf8");
  return file;
}

function run(name, file, args, expectedStatus, expectedText = "") {
  const result = spawnSync(process.execPath, [validator, file, ...args], { encoding: "utf8" });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.status !== expectedStatus || (expectedText && !output.includes(expectedText))) {
    throw new Error(`${name} failed\nstatus=${result.status}\n${output}`);
  }
  console.log(`PASS ${name}`);
}

const fullDates = ["2026-09-25", "2026-09-26", "2026-09-27"];
const complete = write("complete.html", fullDates);
const missing = write("missing.html", ["2026-09-25", "2026-09-27"]);
const duplicate = write("duplicate.html", ["2026-09-25", "2026-09-26", "2026-09-26"]);
const shortened = write("shortened.html", ["2026-09-25", "2026-09-26"]);

const expectedRange = ["--expected-start=2026-09-25", "--expected-end=2026-09-27"];
run("complete range", complete, expectedRange, 0, "预期 3 天，实际 3 张行程卡");
run("missing date", missing, expectedRange, 1, "缺少日期：2026-09-26");
run("duplicate date", duplicate, expectedRange, 1, "重复日期：2026-09-26");
run("baseline shrink blocked", shortened, ["--expected-start=2026-09-25", "--expected-end=2026-09-26", `--baseline-html=${complete}`], 1, "新版相对旧版删除了日期：2026-09-27");
run("authorized shrink", shortened, ["--expected-start=2026-09-25", "--expected-end=2026-09-26", `--baseline-html=${complete}`, "--allow-date-removal"], 0, "预期 2 天，实际 2 张行程卡");

fs.rmSync(tempDir, { recursive: true, force: true });
console.log("Date coverage validator smoke tests passed.");
