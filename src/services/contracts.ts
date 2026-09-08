/** 服务契约总出口（barrel）：按域拆分后保持历史 import 路径 `services/contracts` 不变。
 *  新代码也可直接从 `services/contracts/<域>-contracts` 引入。 */
export * from "./contracts/clipboard-contracts.js";
export * from "./contracts/editor-contracts.js";
export * from "./contracts/agent-contracts.js";
export * from "./contracts/service-contracts.js";
