# Discord Bot Animator & Avatar Management

This directory contains tools to apply animated GIF avatars to your Discord bot, switch between seasonal themes (like Halloween), and easily rollback anytime.

---

## 🎃 Available Avatars

| File | Description | Theme |
|------|-------------|-------|
| [`avatar.gif`](file:///animator/avatar.gif) | Currently active avatar ready to upload (Default: Jack-o'-Lantern Flame) | Active |
| [`avatar_halloween_flame.gif`](file:///animator/avatar_halloween_flame.gif) | **Jack-o'-Lantern Flame**: Glowing pumpkin orange & golden flame with witch hat, spiderweb, floating embers, and original pulsing equalizer | Halloween (Flame) |
| [`avatar_halloween_spooky.gif`](file:///animator/avatar_halloween_spooky.gif) | **Spooky Phantom**: Royal witch violet & pumpkin amber gradient with witch hat, spiderweb, floating embers, and original pulsing equalizer | Halloween (Spooky) |
| [`avatar_original.gif`](file:///animator/avatar_original.gif) | **Original Icon**: Original cyan/purple neon gradient with pulsing visualizer | Original (Default) |
| [`backup/`](file:///animator/backup/) | Permanent archive of all original avatars, square crops, zoomed crops, and high-res source logos/banners | Backup Vault |

---

## 🚀 How to Apply Halloween Avatar

From the **Resobot root directory**, run any of the following:

### 1. Apply Default Halloween Avatar (Flame)
```bash
npm run avatar:apply
# or
node animator/animate.js
```

### 2. Apply Spooky Witch Violet Theme
```bash
npm run avatar:spooky
# or
node animator/animate.js ./animator/avatar_halloween_spooky.gif
```

### 3. Apply Custom GIF
```bash
node animator/animate.js ./path/to/custom-avatar.gif
```

---

## 🔄 How to Rollback Anytime

Whenever Halloween is over and you want to restore your original bot icon:

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

## 🛠️ Regenerating / Customizing Themes

If you ever want to re-render the Halloween avatars or customize particles/colors:
```bash
python animator/build_halloween_avatars.py
```

## ⚠️ Discord Notes
- Discord has a **rate limit** on avatar changes (typically 2 changes per 10 minutes).
- Changes can take up to a few minutes to propagate across all Discord servers and client caches.
- The bot token is read automatically from the `.env` file in the project root.
