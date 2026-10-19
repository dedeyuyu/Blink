# Blink · 灵动书签

一款轻量、高颜值、支持桌面置顶与悬浮球缩放的加密书签管理软件（Windows 桌面端）。

## ✨ 核心特性

- **🎯 浏览器分身精准投递**：自动识别最近激活的浏览器窗口（支持 Chrome / Edge / Brave 多开分身识别，基于 Windows Shell `IPropertyStore` 提取对应 `--profile-directory`），点击书签即可在当前或指定浏览器分身中直接打开网页。
- **🔐 全量本地加密（AES-256-GCM + Scrypt）**：
  - 首次启动设置专属主密码，支持随时在设置中修改密码或一键上锁。
  - 书签数据采用 `Scrypt` 密钥派生 + `AES-256-GCM` 全量加密存储，同时禁用 Chromium 磁盘缓存并在上锁时自动擦除内存明文。
- **✨ 灵动悬浮球与置顶面板**：
  - 支持窗口始终置顶（Always on Top）。
  - 支持一键收缩为桌面迷你悬浮球（Orb 模式），随用随点展开，不遮挡日常工作视线。
- **🎨 分类归档与多色高亮标签**：
  - 支持多分类文件夹管理（新建、编辑颜色/名称、删除分类夹时可选「保留书签至全部未分类」或「连同书签一并删除」）。
  - 支持 8 种主题色彩标签筛选、书签置顶、拖拽自由排序及跨分类拖拽归档。
- **📥 浏览器书签增量导入**：支持一键导入 Chrome / Edge / Brave 导出的 HTML 书签文件，每次导入均为增量新增，不覆盖已有书签。

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 编译原生桥接组件（可选，仓库已附带预编译版本）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-native.ps1
```

### 3. 启动软件

- 直接双击根目录下的 **`启动Blink书签.exe`** 或 **`Start-Blink.bat`**
- 或通过命令行启动：

```bash
npm start
```
