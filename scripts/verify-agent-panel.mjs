import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const appPath = path.join(root, "src/App.tsx");
const agentPath = path.join(root, "src/agent-panel.tsx");
const cssPath = path.join(root, "src/App.css");
const iconPath = path.join(root, "assets/brand/icons/256/agent-access.png");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Agent panel verification failed: ${message}`);
    process.exitCode = 1;
  }
}

const app = read(appPath);
const agent = read(agentPath);
const css = read(cssPath);

assert(fs.existsSync(iconPath), "agent access icon asset is missing");
assert(fs.statSync(iconPath).size > 1024, "agent access icon asset looks empty");
assert(app.includes("agentAccessIcon"), "App does not import/use the Agent access icon");
assert(app.includes('className="footer-agent-slot"'), "Agent trigger is not in the bottom-left dock slot");
assert(app.includes('className={activeSurface === "agent" ? "agent-overlay open" : "agent-overlay"}'), "Agent panel is not rendered as an overlay");
assert(!app.includes("PanelSurfaceTabs"), "Top Agent tab component still exists");
assert(!css.includes("panel-surface-tabs"), "Top Agent tab styles still exist");
assert(!app.includes("{activeSurface === \"clipboard\" ? (\n          <GlassSearchBar"), "Search bar is still gated by Agent surface state");
assert(!app.includes('resetKey={`${activeSurface}:workspace'), "Workspace route is still remounted by Agent surface state");
assert(agent.includes("onCopyResult(lastResult)"), "Agent copy result action is not wired");
assert(agent.includes("onSaveResult(lastResult"), "Agent save result action is not wired");
assert(agent.includes("onFavoriteClip(sourceClip)"), "Agent favorite source action is not wired");
assert(agent.includes("onArchiveClip(sourceClip)"), "Agent archive source action is not wired");
assert(css.includes(".agent-overlay.open"), "Agent overlay open style is missing");
assert(css.includes("transform: translateY(0) scale(1)"), "Agent overlay enter animation is missing");
assert(css.includes(".agent-access-icon"), "Agent icon style is missing");

if (!process.exitCode) {
  console.log("Agent panel verification passed");
}
