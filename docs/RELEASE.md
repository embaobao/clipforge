# ClipForge Release Contract

ClipForge 第一阶段发布使用 GitHub Releases。

## 发布方式

### 方式一：GitHub Actions 自动发布（推荐）

推送到符合 `v*` 格式的 tag 会自动触发发布工作流，构建 macOS arm64 和 x64 两个版本，签名后发布到 GitHub Releases。

#### 1. 准备：配置 GitHub Secrets

在仓库 Settings → Secrets and variables → Actions 中添加以下 Secrets：

| Secret 名称 | 说明 | 生成方式 |
|------------|------|---------|
| `TAURI_UPDATER_PUBLIC_KEY` | 更新器公钥 | 见下方"生成签名密钥" |
| `TAURI_SIGNING_PRIVATE_KEY` | 更新器私钥（base64 编码或直接粘贴） | 见下方"生成签名密钥" |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码（如果设置了的话） | 生成时设置的密码 |

#### 2. 生成签名密钥

在本地生成 Tauri 更新签名密钥对（密钥不要提交到仓库）：

```bash
# 生成密钥对（会询问是否设置密码，建议设置）
pnpm tauri signer generate -w ~/.tauri/clipforge.key
```

生成后得到两个文件：
- `~/.tauri/clipforge.key` — 私钥（保密！）
- `~/.tauri/clipforge.key.pub` — 公钥

提取公钥内容：
```bash
cat ~/.tauri/clipforge.key.pub
```

提取私钥内容（用于 GitHub Secrets）：
```bash
cat ~/.tauri/clipforge.key
```

#### 3. 触发发布

打 tag 并推送：

```bash
# 确认版本号已在 package.json 中更新
git tag v0.1.0
git push origin v0.1.0
```

或在 GitHub Actions 页面手动触发 `Release` 工作流，选择发布渠道（stable / prerelease）。

#### 4. 发布产物

工作流完成后，GitHub Release 页面会包含以下文件：

- `ClipForge_<version>_aarch64.dmg` — Apple Silicon 安装包
- `ClipForge_<version>_aarch64.dmg.sig` — 更新签名
- `ClipForge_<version>_x64.dmg` — Intel 安装包
- `ClipForge_<version>_x64.dmg.sig` — 更新签名
- `latest.json` — Tauri 更新清单（updater 会自动下载这个）
- `checksums.txt` — SHA-256 校验和
- `CLIPFORGE_MUST_READ.html` — 安装必读

### 方式二：本地构建发布

适用于测试或本地验证。

```bash
# 1. 设置环境变量
export CLIPFORGE_RELEASE_REQUIRE_SIGNATURES=1
export CLIPFORGE_UPDATER_PUBLIC_KEY="$(cat ~/.tauri/clipforge.key.pub)"
export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/clipforge.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="你的密码"

# 2. 构建（会自动签名 + 生成 latest.json）
./scripts/build-mac-release.sh

# 3. 产物在 release/ 目录下
ls -la release/
```

## Artifacts

发布产物命名规则：

- `ClipForge_<version>_aarch64.dmg`
- `ClipForge_<version>_x64.dmg`
- 可选更新签名：`<artifact>.sig`
- `latest.json`
- `checksums.txt`
- `CLIPFORGE_MUST_READ.html`

`scripts/build-mac-release.sh` 创建本地 macOS DMG，然后运行
`scripts/generate-release-metadata.mjs`。

## Manifest

`release/latest.json` 遵循 Tauri updater manifest 格式：

- `version`
- `notes`
- `pub_date`
- `platforms[darwin-aarch64 | darwin-x86_64].url`
- `platforms[...].signature`
- `clipforge.channel`
- `clipforge.minAppVersion`
- `clipforge.critical`
- `clipforge.permissionsChanged`

默认发布 URL：

`https://github.com/<GITHUB_REPOSITORY>/releases/download/v<version>/<artifact>`

可用 `CLIPFORGE_RELEASE_BASE_URL` 覆盖（用于测试发布）。

## Checksums

`release/checksums.txt` 包含 SHA-256 行：

`<sha256>  <artifact>`

## 发布前检查

发布前运行这些检查：

```bash
pnpm check:i18n
pnpm build
cd src-tauri && cargo check
```

## 发布渠道

- `stable`：普通公开发布。
- `prerelease`：GitHub 预发布；设置 `CLIPFORGE_RELEASE_CHANNEL=prerelease`。

不要在一个 GitHub Release 中混合 stable 和 prerelease 产物。

## 内部测试标记

第一个内部测试构建由 git tag `v0.1.0-internal.1` 追踪。应用包版本保持为 `0.1.0`
（macOS 兼容性原因）；内部标记存在于 git/release 元数据中，而不是
`CFBundleShortVersionString`。

设置窗口已显示当前包版本、包 ID、目标平台和更新端点。更新检查
当前支持从 `CLIPFORGE_UPDATE_MANIFEST` 指定的本地 manifest 路径，并
持久化最后一次检查状态。未签名的本地构建无法执行静默安装；安装
仍然需要签名/公证的发布产物。

## 签名

更新签名使用 Tauri v2 签名密钥。仓库不存储私钥或更新公钥。
发布构建通过临时 Tauri 配置覆盖注入公钥，并在生成
`latest.json` 之前对最终发布产物签名。

在仓库外部生成密钥：

```bash
pnpm tauri signer generate -w ~/.tauri/clipforge.key
```

仅在发布环境中构建已签名的发布更新产物：

```bash
export CLIPFORGE_RELEASE_REQUIRE_SIGNATURES=1
export CLIPFORGE_UPDATER_PUBLIC_KEY="$(cat ~/.tauri/clipforge.key.pub)"
export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/clipforge.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
./scripts/build-mac-release.sh
```

`scripts/build-mac-release.sh` 在严格模式下如果缺少公钥或
签名密钥会快速失败。它用 `pnpm tauri signer sign` 对每个
`release/ClipForge_<version>_<arch>.dmg` 签名，写入 `<artifact>.sig`，然后
`scripts/generate-release-metadata.mjs` 将签名复制到
`release/latest.json`。

本地烟雾构建可以省略这些变量；它们会生成未签名的产物并打印警告。
不要发布未签名的产物。

## 更新检查端到端验证

发布完成后，验证更新检查是否正常工作：

1. 在旧版本应用中，打开设置 → 关于
2. 点击"检查更新"
3. 应该能检测到新版本并显示下载按钮
4. 点击下载，验证签名和下载进度
5. 下载完成后点击安装，验证应用重启并更新到新版本

如果更新失败，检查：
- `latest.json` 是否可访问（直接在浏览器中打开 URL 验证）
- 签名是否正确（公钥和构建时注入的公钥一致）
- 平台标识是否匹配（darwin-aarch64 / darwin-x86_64）
