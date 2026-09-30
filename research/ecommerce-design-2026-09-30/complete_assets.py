"""Archive exact public image URLs observed in the JD page DOM; no page scraping."""
import json,pathlib,urllib.request,concurrent.futures,hashlib
ROOT=pathlib.Path(__file__).parent
raw=ROOT/'assets'/'originals';raw.mkdir(exist_ok=True)
for manifest in sorted((ROOT/'evidence').glob('*-assets.json')):
 d=json.loads(manifest.read_text());known={x['url'] for x in d['bundle']['assets']};missing={x['url'] for x in d['hero']+d['detail'] if x['url'] not in known}
 def save(url):
  assert urllib.parse.urlparse(url).hostname.endswith('.360buyimg.com')
  key=hashlib.sha256(url.encode()).hexdigest()[:16];target=raw/(key+'.avif')
  req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
  with urllib.request.urlopen(req,timeout=25) as res:target.write_bytes(res.read())
  return {'url':url,'path':str(target.resolve()),'id':key,'kind':'image','acquisition':'public_asset_url_observed_in_dom'}
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  for url,result in zip(missing,pool.map(lambda url: (save(url)),missing)):
   d['bundle']['assets'].append(result)
 manifest.write_text(json.dumps(d,ensure_ascii=False,indent=2));print(manifest.stem,'added',len(missing))
