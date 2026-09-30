"""Convert browser-exported research images and build local review contact sheets."""
import json,pathlib
from PIL import Image,ImageDraw
ROOT=pathlib.Path(__file__).parent
for manifest in sorted((ROOT/'evidence').glob('*-assets.json')):
 d=json.loads(manifest.read_text()); key=manifest.name.removesuffix('-assets.json');out=ROOT/'assets'/key;out.mkdir(exist_ok=True)
 lookup={a['url']:a for a in d['bundle']['assets']}
 for kind in ['hero','detail']:
  cards=[]
  for x in d[kind]:
   if x['url'] not in lookup:continue
   a=lookup[x['url']];i=x.get('order',len(cards)+1);dest=out/f'{kind}-{i:02}.jpg'
   if not dest.exists() or x.get('converted_source_url') != x['url']:
    with Image.open(a['path']) as source:
     x['source_frame_count']=getattr(source,'n_frames',1)
     source.convert('RGB').save(dest,quality=93)
    x['converted_source_url']=x['url']
    x['preview_frame']=0
   im=Image.open(dest);x['path']=str(dest.relative_to(ROOT));x['width'],x['height']=im.size
   im.thumbnail((260,620));c=Image.new('RGB',(280,660),'#f1f0ed');c.paste(im,((280-im.width)//2,32));ImageDraw.Draw(c).text((10,10),f'{key} {kind} {i}',fill='black');cards.append(c)
  for p in range(0,len(cards),6):
   group=cards[p:p+6];sheet=Image.new('RGB',(280*len(group),660),'white')
   for j,c in enumerate(group):sheet.paste(c,(j*280,0))
   sheet.save(ROOT/'evidence'/f'{key}-{kind}-sheet-{p//6+1}.jpg')
 manifest.write_text(json.dumps(d,ensure_ascii=False,indent=2))
 print(key,len(d['hero']),len(d['detail']),len(lookup))
