from PIL import Image, ImageDraw, ImageFilter
import math
S = 1024
img = Image.new('RGBA', (S, S), (0,0,0,0))
d = ImageDraw.Draw(img)
# 둥근 어두운 타일 (그라데이션 느낌)
d.rounded_rectangle([40,40,S-40,S-40], radius=190, fill=(5,9,7,255))
d.rounded_rectangle([40,40,S-40,S-40], radius=190, outline=(0,255,90,60), width=4)
# 미세 그리드
grid = Image.new('RGBA',(S,S),(0,0,0,0)); gd = ImageDraw.Draw(grid)
for x in range(90, S-50, 64): gd.line([(x,90),(x,S-90)], fill=(0,255,65,16), width=2)
for y in range(90, S-50, 64): gd.line([(90,y),(S-90,y)], fill=(0,255,65,16), width=2)
img = Image.alpha_composite(img, grid)
# 글로우 심볼 레이어
sym = Image.new('RGBA',(S,S),(0,0,0,0)); sd = ImageDraw.Draw(sym)
cx, cy = S/2, S/2; R = 250
hexpts = [(cx + R*math.cos(math.pi/6 + i*math.pi/3), cy + R*math.sin(math.pi/6 + i*math.pi/3)) for i in range(6)]
sd.polygon(hexpts, outline=(0,255,95,255), width=28)
r2 = 118
sd.line([(cx, cy-r2),(cx, cy+r2)], fill=(200,255,215,255), width=24)
sd.line([(cx-r2, cy),(cx+r2, cy)], fill=(200,255,215,255), width=24)
sd.ellipse([cx-26,cy-26,cx+26,cy+26], fill=(220,255,225,255))
glow = sym.filter(ImageFilter.GaussianBlur(30))
img = Image.alpha_composite(img, glow)
img = Image.alpha_composite(img, glow)
img = Image.alpha_composite(img, sym)
img.save('build/icon_1024.png')
img.save('build/icon.ico', sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)])
print('PNG + ICO 생성 완료')
