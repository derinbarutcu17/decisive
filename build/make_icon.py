from PIL import Image, ImageDraw

S = 1024
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([64, 64, 960, 960], radius=220, fill='#17171a')
# quadrant colors: do, schedule, delegate, eliminate
colors = ['#e5484d', '#30a46c', '#f5a524', '#8d8d8d']
pad, gap = 180, 48
tile = (S - 2 * pad - gap) // 2
pos = [
    (pad, pad),
    (pad + tile + gap, pad),
    (pad, pad + tile + gap),
    (pad + tile + gap, pad + tile + gap),
]
for (x, y), c in zip(pos, colors):
    d.rounded_rectangle([x, y, x + tile, y + tile], radius=60, fill=c)
img.save('build/icon.png')

# Menu-bar variant: keep the same four-square silhouette, but use a simple
# monochrome mark so the template image remains legible at 16–18px.
menu = Image.new('RGBA', (S, S), (0, 0, 0, 0))
menu_draw = ImageDraw.Draw(menu)
menu_pad, menu_gap = 86, 76
menu_tile = (S - 2 * menu_pad - menu_gap) // 2
menu_pos = [
    (menu_pad, menu_pad),
    (menu_pad + menu_tile + menu_gap, menu_pad),
    (menu_pad, menu_pad + menu_tile + menu_gap),
    (menu_pad + menu_tile + menu_gap, menu_pad + menu_tile + menu_gap),
]
for x, y in menu_pos:
    menu_draw.rounded_rectangle([x, y, x + menu_tile, y + menu_tile], radius=96, fill='#ffffff')
menu.save('build/menu-bar-icon.png')
print('icons written')
