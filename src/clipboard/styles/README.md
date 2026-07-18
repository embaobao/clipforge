# src/clipboard/styles

剪贴板主面板（clipboard surface）的样式文件。

- 选择器必须以 `.clipboard-surface` 或 `data-surface="clipboard"` 为根作用域。
- 不再向 `src/App.css` 追加新的 `.quick-row` / `.toolbar` / `.dropdown-content` 全局覆盖。
- 待迁移：quick-row、top-toolbar、搜索栏、多选工具条、Agent 面板 overlay 等。
