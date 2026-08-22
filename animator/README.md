# Discord Bot Animator

This folder contains a standalone script to apply an animated GIF avatar (and optionally a banner) to your Discord bot.

## How to Use

### 1. Add your GIF
Place your animated `.gif` file in this folder and name it `avatar.gif`:
```
animator/
├── animate.js
├── avatar.gif     ← Your animated avatar (place it here)
├── banner.gif     ← Optional: animated banner
└── README.md
```

### 2. Run the script
From the **Resobot root folder**, run:

```bash
node animator/animate.js
```

Or specify a custom path:
```bash
node animator/animate.js ./path/to/my-cool-avatar.gif
```

For both avatar AND banner:
```bash
node animator/animate.js ./animator/avatar.gif ./animator/banner.gif
```

### 3. Done!
The script uploads the GIF once. Discord will display it as an animated avatar. You don't need to keep the script running.

## ⚠️ Important Notes
- The GIF **must** be a `.gif` file for animation to work
- Discord has a **rate limit** on profile changes — don't run this too frequently
- The bot token is automatically read from the `.env` file in the parent directory
- **Banner** animation requires your bot to have Nitro-equivalent features (most bots support it)

## Recommended GIF Specs
- **Avatar**: 128×128 px or 256×256 px, under 8 MB
- **Banner**: 960×540 px or 600×240 px, under 8 MB
