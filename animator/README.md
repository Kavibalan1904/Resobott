# Discord Bot Animator & Avatar Management

This directory contains tools to manage and apply animated GIF avatars to your Discord bot and restore backups anytime.

---

## 🎨 Available Avatars

| File | Description | Theme |
|------|-------------|-------|
| [`avatar.gif`](file:///animator/avatar.gif) | Currently active avatar ready to upload | Active |
| [`avatar_original.gif`](file:///animator/avatar_original.gif) | **Original Icon**: Original cyan/purple neon gradient with pulsing visualizer | Original (Default) |
| [`backup/`](file:///animator/backup/) | Permanent archive of all original avatars, square crops, zoomed crops, and high-res source logos/banners | Backup Vault |

---

## 🚀 How to Apply Avatar

From the **Resobot root directory**, run any of the following:

### 1. Apply Active Avatar (`avatar.gif`)
```bash
npm run avatar:apply
# or
node animator/animate.js
```

### 2. Apply Custom GIF
```bash
node animator/animate.js ./path/to/custom-avatar.gif
```

---

## 🔄 How to Rollback / Restore Original

Whenever you want to restore the original bot icon:

### Option A: Automatic Rollback (Restores file & uploads to Discord)
```bash
npm run avatar:rollback
# or
node animator/rollback.js
```

### Option B: Local-only Restore (Restores file without uploading yet)
```bash
node animator/rollback.js --local
```

### Option C: Direct Upload of Original
```bash
node animator/animate.js ./animator/avatar_original.gif
```

---

## ⚠️ Discord Notes
- Discord has a **rate limit** on avatar changes (typically 2 changes per 10 minutes).
- Changes can take up to a few minutes to propagate across all Discord servers and client caches.
- The bot token is read automatically from the `.env` file in the project root.
