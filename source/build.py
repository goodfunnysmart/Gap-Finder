# Rebuilds index.html from the taxonomy JSON in ./data and template.html.
# Usage: python3 build.py   (writes ../index.html)
import json
ts=json.load(open('data/topics.json'))['topics'];ds=json.load(open('data/dependencies.json'))['dependencies']
tt=[dict(i=t['id'],s=t['subject'],d=t['domain'],n=t['name'],ds=t['description'],a=t['ageRangeStart'],b=t['ageRangeEnd'],c=t['centrality'],e=t['evidence'],p=t['assessmentPrompt']) for t in ts]
ids={t['i'] for t in tt}
e=[[d['topicId'],d['prerequisiteId'],1 if d['strength']=='hard' else 0,d['reason']] for d in ds if d['topicId'] in ids and d['prerequisiteId'] in ids]
dflt=[t['i'] for t in tt if t['n']=='Adding fractions (different denominators)'][0]
s=json.dumps(dict(t=tt,e=e,**{'def':dflt}),ensure_ascii=False,separators=(',',':')).replace('</','<\\/')
open('../index.html','w').write(open('template.html').read().replace('__DATA__',s))
