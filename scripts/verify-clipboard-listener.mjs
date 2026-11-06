/** RS-51：clipboard-changed 前端事件闸门行为校验入口。
 *  仓库无 JS 测试运行器，本脚本用 node --experimental-strip-types 直跑 TS 断言
 *  （node ≥22.6），挂入 pnpm test:unit 门禁。 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const checkPath = fileURLToPath(new URL("./verify-clipboard-listener.check.ts", import.meta.url));
const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", checkPath],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
