#!/usr/bin/env node
// Shared, deliberately small parser for the skill's --name=value CLI options.
function readOption(args, name) {
  const prefix = `--${name}=`;
  return (args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || "").trim();
}

function readCsvOption(args, name) {
  return readOption(args, name).split(",").map((item) => item.trim()).filter(Boolean);
}

module.exports = { readOption, readCsvOption };
