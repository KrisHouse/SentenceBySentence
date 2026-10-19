"""Draws the app icon and writes every size used by the app and shortcuts.
Run: python3 icons/make_icon.py   (needs Pillow: pip install pillow)
"""
import os
from PIL import Image, ImageDraw
S=4096; k=S/1024
def P(x,y): return (x*k,y*k)
def bez(p0,p1,p2,p3,n=60):
    pts=[]
    for i in range(n+1):
        t=i/n; u=1-t
        pts.append((u**3*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t**3*p3[0], u**3*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t**3*p3[1]))
    return pts
img=Image.new("RGBA",(S,S),(0,0,0,0))
# background: vertical gradient in a rounded square
grad=Image.new("RGBA",(S,S))
gd=ImageDraw.Draw(grad)
top=(50,120,104); bot=(26,72,62)
for y in range(S):
    t=y/S; gd.line([(0,y),(S,y)],fill=tuple(int(top[i]+(bot[i]-top[i])*t) for i in range(3))+(255,))
mask=Image.new("L",(S,S),0)
ImageDraw.Draw(mask).rounded_rectangle([P(40,40),P(984,984)],radius=220*k,fill=255)
img.paste(grad,(0,0),mask)
d=ImageDraw.Draw(img)
cream=(248,241,226,255); brass=(222,168,78,255); sage=(44,106,92,255)
# clock ring
cx,cy,r,w=512,360,206,58
d.ellipse([P(cx-r,cy-r),P(cx+r,cy+r)],outline=cream,width=int(w*k))
# elapsed arc in brass (top, clockwise ~ 115 degrees)
d.arc([P(cx-r,cy-r),P(cx+r,cy+r)],start=-90,end=25,fill=brass,width=int(w*k))
# round caps for the arc
import math
for ang in (-90,25):
    a=math.radians(ang); x=cx+(r-w/2)*math.cos(a); y=cy+(r-w/2)*math.sin(a)
    d.ellipse([P(x-w/2+0.5,y-w/2+0.5),P(x+w/2-0.5,y+w/2-0.5)],fill=brass)
# hands
def thick(a,b,wd,col):
    d.line([P(*a),P(*b)],fill=col,width=int(wd*k))
    for x,y in (a,b): d.ellipse([P(x-wd/2,y-wd/2),P(x+wd/2,y+wd/2)],fill=col)
thick((cx,cy),(cx,cy-120),40,cream)
thick((cx,cy),(cx+92,cy+52),40,cream)
d.ellipse([P(cx-34,cy-34),P(cx+34,cy+34)],fill=brass)
# open book
gap=10
def page(side):
    s=1 if side>0 else -1
    x0=512+s*gap
    topc=bez((x0,660),(x0+s*90,612),(x0+s*220,600),(x0+s*318,628))
    botc=bez((x0+s*318,852),(x0+s*220,824),(x0+s*90,836),(x0,884))
    return [P(*p) for p in topc+[(x0+s*318,628)]+botc]
for s in (-1,1): d.polygon(page(s),fill=cream)
# text lines on the pages; last line on the right page in brass = newly revealed sentence
def tline(side,yoff,length,col,wd=20):
    s=side; x0=512+s*(gap+52)
    f=length/236; pts=bez((x0,678+yoff),(x0+s*70*f,646+yoff+ (1-f)*14),(x0+s*150*f,640+yoff+(1-f)*16),(x0+s*length,656+yoff+(1-f)*12),40)
    d.line([P(*p) for p in pts],fill=col,width=int(wd*k),joint="curve")
    for p in (pts[0],pts[-1]): d.ellipse([P(p[0]-wd/2,p[1]-wd/2),P(p[0]+wd/2,p[1]+wd/2)],fill=col)
lite=(44,106,92,150)
for i,yo in enumerate((20,70,120)):
    tline(-1,yo,236,lite)
tline(1,20,236,lite); tline(1,70,236,lite); tline(1,120,150,brass)
big=img.resize((1024,1024),Image.LANCZOS)
out=os.path.dirname(os.path.abspath(__file__))
big.save(os.path.join(out,"icon-1024.png"))
big.resize((180,180),Image.LANCZOS).save(os.path.join(out,"icon-180.png"))
big.resize((64,64),Image.LANCZOS).save(os.path.join(out,"favicon-64.png"))
big.save(os.path.join(out,"icon.ico"),sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
big.save(os.path.join(out,"icon.icns"))
