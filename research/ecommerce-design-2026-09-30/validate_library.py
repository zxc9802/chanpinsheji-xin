"""Validate source provenance, screen mappings, saved images, and local page links."""
from pathlib import Path
from urllib.parse import unquote, urlparse
from html.parser import HTMLParser
import json
from PIL import Image

ROOT = Path(__file__).parent
data = json.loads((ROOT/'agent-library/catalog.json').read_text())
assert len(data['products']) == data['counts']['products'] == 20
screens = {}
image_count = 0
for product in data['products']:
    assets = {a['id']:a for a in product['assets']}
    assert len(assets) == len(product['assets'])
    assert product['platform']=='JD' and product['source_url'].startswith('https://item.jd.com/')
    for evidence in product['heat_evidence']:
        assert (ROOT/evidence['evidence_file']).is_file()
        assert evidence['display'] in (ROOT/evidence['evidence_file']).read_text()
        assert evidence['captured_at']=='2026-09-30'
    for a in assets.values():
        assert a['visually_reviewed']
        assert a['converted_source_url'] == a['source_url']
        assert urlparse(a['source_url']).hostname.endswith('.360buyimg.com')
        with Image.open(ROOT/a['path']) as im:
            assert im.size == (a['width'],a['height'])
            im.verify()
        image_count += 1
    for group,kind in [('main','hero'),('detail','detail')]:
        covered=set()
        for i,s in enumerate(product[group],1):
            assert s['id'] not in screens and s['order']==i
            screens[s['id']]=s
            assert s['copy_source_claims'] is False
            assert s['default_auto_select'] == (s['eligibility']=='ready')
            if s['eligibility']=='conditional':assert s['required_inputs']
            for aid in s['source_asset_ids']:
                assert aid in assets and assets[aid]['kind']==kind
                covered.add(aid)
        assert covered == {aid for aid,a in assets.items() if a['kind']==kind}

candidates=json.loads((ROOT/'agent-library/candidates.json').read_text())
for c in candidates:
    assert screens[c['reference_id']]['eligibility']!='excluded'
    assert all((ROOT/p).is_file() for p in c['reference_images'])
for recipe in json.loads((ROOT/'agent-library/generation-recipes.json').read_text()):
    for group in ('main','detail'):
        for s in recipe[group]:
            ref=screens[s['reference_id']]
            assert ref['role']==s['role'] and ref['eligibility']!='excluded'
            assert s['source_asset_ids']==ref['source_asset_ids']

class LinkParser(HTMLParser):
    def handle_starttag(self,tag,attrs):
        for key,value in attrs:
            if key in ('src','href') and value and not value.startswith(('http:','https:','#')):
                path=unquote(value.split('#')[0])
                assert (ROOT/path).is_file(),path
pages=list(ROOT.glob('*.html'))
for p in pages:LinkParser().feed(p.read_text())
assert image_count==data['counts']['reference_images']==541
assert len(screens)==data['counts']['semantic_detail_screens']+data['counts']['hero_images']==489
result=dict(status='passed',image_files=image_count,screen_records=len(screens),candidate_records=len(candidates),html_pages=len(pages),
            checks=['image_decode_and_dimensions','all_source_images_mapped','source_urls_and_evidence_files','eligibility_filters','recipe_references','local_html_links'])
(ROOT/'validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(result,ensure_ascii=False))
