import os
import sys
import glob
import time
import math
import colorsys
from PIL import Image, ImageSequence, ImageDraw

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

def prepare_witch_hat():
    hat_files = glob.glob('animator/assets/witch_hat_asset_*.jpg')
    if not hat_files:
        raise FileNotFoundError('Witch hat asset not found in animator/assets/')
    hat_img = Image.open(hat_files[-1]).convert('RGBA')
    
    # Transparency based on brightness
    data = hat_img.getdata()
    new_data = []
    for item in data:
        r, g, b, a = item
        br = max(r, g, b)
        if br < 22:
            new_data.append((0, 0, 0, 0))
        elif br < 60:
            alpha = int((br - 22) / 38.0 * 255)
            new_data.append((r, g, b, alpha))
        else:
            new_data.append((r, g, b, 255))
    hat_img.putdata(new_data)
    # Scale to fit nicely on the upper-left crest of the 'R'
    return hat_img.resize((80, 80), Image.Resampling.LANCZOS)

def prepare_spiderweb():
    web_files = glob.glob('animator/assets/halloween_spiderweb_asset_*.jpg')
    if not web_files:
        return None
    web_img = Image.open(web_files[-1]).convert('RGBA')
    data = web_img.getdata()
    new_data = []
    for item in data:
        r, g, b, a = item
        br = max(r, g, b)
        if br < 30:
            new_data.append((0, 0, 0, 0))
        else:
            alpha = int(min(255, (br - 30) * 1.6))
            # Eerie warm bone-white spiderweb
            new_data.append((255, 220, 180, int(alpha * 0.75)))
    web_img.putdata(new_data)
    return web_img.resize((50, 50), Image.Resampling.LANCZOS)

def build_lut(theme_mode='flame'):
    lut = {}
    
    def mapper(r, g, b):
        h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
        
        # Dark Background
        if v < 0.22 and s < 0.70:
            if theme_mode == 'flame':
                # Deep haunted obsidian with faint warm dark ember tone
                nr = int(max(0, min(255, r * 0.85 + 2)))
                ng = int(max(0, min(255, g * 0.50)))
                nb = int(max(0, min(255, b * 0.70 + 2)))
            else:
                # Eerie witch midnight with faint phantom violet undertone
                nr = int(max(0, min(255, r * 0.85 + 3)))
                ng = int(max(0, min(255, g * 0.45)))
                nb = int(max(0, min(255, b * 0.75 + 5)))
            return (nr, ng, nb)
            
        # Text 'R E S O'
        if v > 0.90 and s < 0.20:
            # Warm candlelight ivory
            return (255, 235, 205)
            
        orig_h_deg = h * 360.0
        
        if theme_mode == 'flame':
            # Flame Theme: Pure Glowing Jack-o'-Lantern (Golden amber to fiery pumpkin orange)
            if 180 <= orig_h_deg <= 230:
                t = (orig_h_deg - 180) / 50.0
                new_h = 42.0 - t * 18.0  # 42 (amber gold) to 24 (pumpkin orange)
                new_s = min(1.0, s * 1.25)
                new_v = min(1.0, v * 1.05)
            elif 230 < orig_h_deg <= 295:
                t = (orig_h_deg - 230) / 65.0
                new_h = 24.0 - t * 18.0  # 24 to 6 (rich orange to red-orange)
                if new_h < 0: new_h += 360.0
                new_s = min(1.0, s * 1.30)
                new_v = min(1.0, v * 1.05)
            else:
                new_h = orig_h_deg
                new_s = s
                new_v = v
        else:
            # Spooky Theme: Witch Phantom Violet on top & Fiery Pumpkin Orange on bottom
            if 180 <= orig_h_deg <= 220:
                t = (orig_h_deg - 180) / 40.0
                new_h = 40.0 - t * 16.0  # 40 (gold) to 24 (orange)
                new_s = min(1.0, s * 1.20)
                new_v = min(1.0, v * 1.05)
            elif 220 < orig_h_deg <= 250:
                t = (orig_h_deg - 220) / 30.0
                new_h = 24.0 - t * 14.0  # 24 to 10
                new_s = min(1.0, s * 1.25)
                new_v = min(1.0, v * 1.05)
            elif 250 < orig_h_deg <= 295:
                t = (orig_h_deg - 250) / 45.0
                new_h = 275.0 + t * 15.0  # 275 to 290 (spooky royal violet)
                new_s = min(1.0, s * 1.20)
                new_v = min(1.0, v * 1.05)
            else:
                new_h = orig_h_deg
                new_s = s
                new_v = v
                
        nr, ng, nb = colorsys.hsv_to_rgb(new_h / 360.0, new_s, new_v)
        return (int(nr * 255), int(ng * 255), int(nb * 255))
        
    return mapper

def generate_animated_gif(source_gif_path, output_gif_path, theme_mode='flame', hat_img=None, web_img=None):
    print(f'\\n[Halloween Generator] Processing theme: {theme_mode}...')
    t0 = time.time()
    
    src = Image.open(source_gif_path)
    total_frames = getattr(src, 'n_frames', 1)
    
    delays = []
    disposals = []
    color_map = build_lut(theme_mode)
    cache = {}
    
    hat_pos = (56, 7)    # Perched naturally on the crest of the R
    web_pos = (185, 20)  # Top-right corner of badge
    
    # 8 subtle looping ember particles (warm floating embers)
    embers = [
        {'x': 50,  'start_y': 220, 'speed': 0.8, 'phase': 0.0,  'size': 2, 'alpha': 180},
        {'x': 75,  'start_y': 230, 'speed': 1.1, 'phase': 0.25, 'size': 1, 'alpha': 210},
        {'x': 110, 'start_y': 215, 'speed': 0.9, 'phase': 0.50, 'size': 2, 'alpha': 170},
        {'x': 140, 'start_y': 225, 'speed': 1.2, 'phase': 0.15, 'size': 1, 'alpha': 220},
        {'x': 175, 'start_y': 210, 'speed': 0.7, 'phase': 0.70, 'size': 2, 'alpha': 160},
        {'x': 195, 'start_y': 235, 'speed': 1.0, 'phase': 0.40, 'size': 1, 'alpha': 190},
        {'x': 90,  'start_y': 240, 'speed': 0.85,'phase': 0.85, 'size': 2, 'alpha': 180},
        {'x': 155, 'start_y': 230, 'speed': 1.05,'phase': 0.60, 'size': 1, 'alpha': 200},
    ]
    
    processed_frames = []
    
    for idx, frame in enumerate(ImageSequence.Iterator(src)):
        delays.append(frame.info.get('duration', 40))
        disposals.append(frame.info.get('disposal', 2))
        
        rgba = frame.convert('RGBA')
        flat_data = list(rgba.getdata())
        
        new_data = []
        for r, g, b, a in flat_data:
            key = (r, g, b)
            if key in cache:
                nr, ng, nb = cache[key]
            else:
                nr, ng, nb = color_map(r, g, b)
                cache[key] = (nr, ng, nb)
            new_data.append((nr, ng, nb, a))
            
        base = Image.new('RGBA', rgba.size)
        base.putdata(new_data)
        
        # Add subtle animated floating embers
        ember_overlay = Image.new('RGBA', rgba.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(ember_overlay)
        progress = idx / float(total_frames)
        
        for em in embers:
            t = (progress + em['phase']) % 1.0
            cur_y = em['start_y'] - (t * 180.0)
            drift_x = em['x'] + math.sin(t * math.pi * 4.0) * 8.0
            r_sz = em['size']
            alpha = int(em['alpha'] * math.sin(t * math.pi)) # Fade in and out
            if alpha > 10:
                draw.ellipse(
                    [drift_x - r_sz, cur_y - r_sz, drift_x + r_sz, cur_y + r_sz],
                    fill=(255, 170, 40, alpha)
                )
        base.alpha_composite(ember_overlay)
        
        # Composite spiderweb
        if web_img:
            base.paste(web_img, web_pos, web_img)
            
        # Composite witch hat
        if hat_img:
            base.paste(hat_img, hat_pos, hat_img)
            
        # Convert to P mode for GIF with shared/optimized palette
        p_frame = base.convert('RGB').quantize(colors=128, method=Image.Resampling.LANCZOS, dither=Image.Dither.NONE)
        processed_frames.append(p_frame)
        
        if (idx + 1) % 40 == 0 or idx == total_frames - 1:
            print(f'   Frame {idx + 1}/{total_frames} completed...')
            
    print(f'💾 Saving animated GIF to {output_gif_path}...')
    first_frame = processed_frames[0]
    first_frame.save(
        output_gif_path,
        save_all=True,
        append_images=processed_frames[1:],
        duration=delays,
        loop=0,
        disposal=2,
        optimize=True
    )
    
    file_size_mb = os.path.getsize(output_gif_path) / (1024 * 1024)
    print(f'✓ Successfully generated {output_gif_path} ({file_size_mb:.2f} MB) in {time.time() - t0:.2f}s')

def main():
    source_gif = 'animator/avatar_original.gif'
    if not os.path.exists(source_gif):
        source_gif = 'animator/backup/avatar_r_tight.gif'
        
    hat_img = prepare_witch_hat()
    web_img = prepare_spiderweb()
    
    # 1. Flame theme (Jack-o'-Lantern Flame)
    flame_out = 'animator/avatar_halloween_flame.gif'
    generate_animated_gif(source_gif, flame_out, theme_mode='flame', hat_img=hat_img, web_img=web_img)
    
    # 2. Spooky theme (Witch Violet & Amber)
    spooky_out = 'animator/avatar_halloween_spooky.gif'
    generate_animated_gif(source_gif, spooky_out, theme_mode='spooky', hat_img=hat_img, web_img=web_img)
    
    # Set default animator/avatar.gif to the flame theme (highest impact & contrast)
    import shutil
    shutil.copyfile(flame_out, 'animator/avatar.gif')
    print('\\n🎃 Set default animator/avatar.gif -> avatar_halloween_flame.gif')

if __name__ == '__main__':
    main()
