const fs = require("fs");
const path = require("path");
function requiredLockedFiles(root) {
  const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const relative = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(relative) : [relative];
  });
  return [...walk("assets").filter(f => f !== "assets/page-template.lock.json"),
    ...walk("scripts").filter(f => f.endsWith(".js") && !path.basename(f).startsWith("test-")),
    ...walk("supabase"), ...walk(".githooks"),
    "references/trip-data.schema.json", "references/module-registry.json"].sort();
}
module.exports = { requiredLockedFiles };
