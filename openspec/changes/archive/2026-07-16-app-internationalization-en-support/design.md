# 设计：应用国际化与英文支持

## 语言策略

支持三种选择：

```ts
export type AppLanguagePreference = "system" | "zh-CN" | "en-US";
export type AppLocale = "zh-CN" | "en-US";
```

- 默认：`system`。
- 系统语言为中文时使用 `zh-CN`。
- 其他语言默认使用 `en-US`。
- 用户显式选择后写入 settings，重启保持。

## 字典结构

第一阶段使用本地静态字典，避免引入重型运行时：

```text
src/i18n/
  index.ts
  locale.ts
  dictionaries/
    zh-CN.ts
    en-US.ts
```

字典 key 使用域名前缀：

```ts
export const zhCN = {
  "app.name": "ClipForge",
  "quick.search.placeholder": "搜索剪贴板历史",
  "quick.empty.title": "暂无剪贴板记录",
  "settings.language.label": "语言",
  "settings.language.system": "跟随系统",
  "tray.openQuickPanel": "打开快捷面板",
  "update.check": "检查更新"
} as const;
```

英文必须与中文 key 完全对齐。缺失 key 在开发环境抛 warning，生产环境回退到中文或 key。

## API 设计

```ts
export function t(key: I18nKey, params?: Record<string, string | number>): string;

export function useI18n(): {
  locale: AppLocale;
  preference: AppLanguagePreference;
  setPreference(next: AppLanguagePreference): Promise<void>;
  t: typeof t;
};
```

第一阶段支持简单参数替换：

```ts
t("update.available", { version: "0.1.1" });
```

不做复杂 ICU message format，避免过早引入大型依赖。

## 设置持久化

在现有 settings JSON 中增加：

```json
{
  "language": "system"
}
```

Rust settings command 返回语言偏好，前端启动时解析实际 locale。托盘菜单和原生提示需要从 Rust 侧读取当前语言或接收前端同步后的语言。

## 覆盖范围

第一阶段必须覆盖：

- 快速面板：搜索 placeholder、分组、空状态、按钮 tooltip、批量操作提示。
- 设置页：导航、表单 label、帮助文案、路径说明、语言设置。
- 托盘菜单：打开快捷面板、偏好设置、暂停/恢复监听、退出。
- 更新能力：检查更新、已是最新、发现新版本、下载、失败、忽略版本。
- 权限提示：Accessibility、剪贴板读取/写入、粘贴模拟失败。
- 详情页基础动作：复制、粘贴、删除、收藏、归档、编辑。

第一阶段不覆盖：

- README、开发文档、OpenSpec 文档。
- 用户剪贴板正文、用户 tag、文件名。
- 结构化日志字段名、命令名、错误码。

## HTML lang 与标题

- `index.html` / `settings.html` 初始保留安全默认值。
- 前端启动后根据实际 locale 设置 `document.documentElement.lang`。
- `document.title` 通过 i18n 设置。
- 设置窗口标题通过 Tauri command 或窗口创建参数同步。

## 文案收口流程

开发阶段允许临时中文，但发版前必须执行：

1. 扫描 `src/**` 和 `src-tauri/src/**` 的用户可见硬编码中文。
2. 排除测试、日志字段、错误码、fixture、文档路径。
3. 为新增文案分配 key。
4. 同步补齐 `zh-CN` 和 `en-US`。
5. 运行 key 对齐检查。

## 检查脚本

新增脚本建议：

```text
scripts/check-i18n-keys.mjs
scripts/find-hardcoded-user-text.mjs
```

检查内容：

- `zh-CN` 与 `en-US` key 完全一致。
- `t("...")` 引用的 key 存在。
- 用户可见中文硬编码残留需要进入报告。
- 允许白名单注释或配置文件排除非 UI 文案。

## 风险

- 一次性替换全部 UI 文案容易引入回归，应按窗口/区域分批迁移。
- 托盘菜单在 Rust 侧生成，需要明确前端语言变更后如何刷新菜单。
- 文案长度差异可能影响快速面板布局，英文长文案必须通过截图或手动检查确认不挤压核心控件。
