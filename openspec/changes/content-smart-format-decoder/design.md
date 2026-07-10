# 设计：智能解析代码、JSON 与常用解码格式

## 分析流水线

```text
Clip captured
  -> quick classify (sync, cheap)
  -> enqueue deep analysis (async)
  -> store analysis result
  -> detail page renders actions
```

快速分类只做低成本判断：

- 是否像 JSON
- 是否像 URL
- 是否像 Base64
- 是否像 JWT
- 是否像代码/命令
- 文本长度和行数

深度分析异步执行，避免阻塞采集和快速面板。

## Analysis 模型

```ts
export type SmartFormatAnalysis = {
  schemaVersion: 1;
  detectedKinds: Array<"json" | "code" | "command" | "url" | "base64" | "jwt" | "unicode_escape" | "html_entity">;
  confidence: number;
  json?: {
    valid: boolean;
    errorMessage?: string;
    errorOffset?: number;
    formatted?: string;
    minified?: string;
    repairSuggestions?: JsonRepairSuggestion[];
  };
  decoders: Array<{
    kind: "url" | "base64" | "jwt" | "unicode_escape" | "html_entity";
    valid: boolean;
    preview: string;
    errorMessage?: string;
  }>;
  code?: {
    language?: string;
    signals: string[];
  };
};
```

## JSON 补齐策略

第一阶段只做保守修复建议，不直接改写原文：

- 去除 BOM。
- 补齐外层 `{}` 或 `[]` 的建议。
- 移除尾逗号的建议。
- 将单引号替换为双引号的建议。
- 将未加引号 key 加引号的建议。
- 对转义 JSON 字符串先尝试反转义再 parse。

每条建议都产出 patch preview，用户确认后才能复制或保存。

## 常用解码

| 类型 | 检测 | 输出 |
|------|------|------|
| URL encode | `%E4%BD%A0` / `+` | decoded text |
| Base64 | 字符集和 padding 检查 | UTF-8 文本或二进制提示 |
| JWT | 三段 base64url | header/payload JSON |
| Unicode escape | `\u4f60` | decoded text |
| HTML entity | `&amp;` / `&#x27;` | decoded text |

解码结果默认只预览，不覆盖原文。

## 代码识别

第一阶段使用启发式：

- fenced code block
- import/export/function/class
- SQL 关键词
- shell 命令符号和常见命令
- JSON/YAML/TOML 明显结构

后续可引入轻量语法高亮库，但不在第一阶段阻塞。

## UI 动作

详情页根据 analysis 展示动作：

- 格式化 JSON
- 压缩 JSON
- 复制修复建议结果
- URL 解码
- Base64 解码
- JWT 解码
- 保存结果为新条目

动作必须是按钮/菜单项，不自动修改原始条目。

## 安全与性能

- 单条同步快速分类上限 2ms 目标。
- 深度分析对超过大小上限的内容跳过或只分析前 N KB。
- 不执行代码，不访问网络。
- 解码失败必须返回错误，不抛到 UI。
