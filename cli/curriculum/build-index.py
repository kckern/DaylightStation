import os, re, json, glob
ROOT = "/media/kckern/Media/Lectures/Piano With Jonny"
GENERIC = {"Music", "Educational"}

# authored season category map (from the design)
SEASON_CAT = {
 0:  dict(category="reference", pinned=True),
 1:  dict(category="lesson", sequential=True),
 2:  dict(category="lesson", sequential=True),
 3:  dict(category="lesson", sequential=True),
 4:  dict(category="lesson", sequential=True),
 5:  dict(category="lesson", sequential=True),
 6:  dict(category="lesson", sequential=True),
 7:  dict(category="lesson", sequential=True),
 8:  dict(category="lesson", sequential=True),
 9:  dict(category="lesson", sequential=True),
 10: dict(category="repertoire", kind="tutorial",      facets=["difficulty","instructor","style"]),
 11: dict(category="repertoire", kind="challenge",     facets=["difficulty","instructor","style"]),
 12: dict(category="repertoire", kind="accompaniment", facets=["difficulty","instructor","style"]),
}

def tag(txt, key):
    m = re.findall(r"<tag>%s:\s*([^<]+)</tag>" % re.escape(key), txt)
    return [x.strip() for x in m]

def one(txt, el):
    m = re.search(r"<%s>(.*?)</%s>" % (el, el), txt, re.S)
    return (m.group(1).strip() if m else None)

def unesc(s):
    if s is None: return None
    return s.replace("&amp;","&").replace("&lt;","<").replace("&gt;",">").replace("&#39;","'").replace("&quot;",'"')

episodes = {}
season_titles = {}
counts = {}
for nfo in glob.glob(os.path.join(ROOT, "Season *", "*.nfo")):
    base = os.path.basename(nfo)
    if base == "season.nfo":
        txt = open(nfo, encoding="utf-8").read()
        sn = one(txt, "seasonnumber"); ti = one(txt, "title")
        if sn is not None: season_titles[int(sn)] = unesc(ti)
        continue
    txt = open(nfo, encoding="utf-8").read()
    s = one(txt, "season"); e = one(txt, "episode")
    if s is None or e is None: continue
    s, e = int(s), int(e)
    genres = re.findall(r"<genre>([^<]+)</genre>", txt)
    style = next((g for g in genres if g not in GENERIC), None)
    ep = dict(
        title=unesc(one(txt, "title")),
        plot=unesc(one(txt, "plot")),
        course=unesc((tag(txt,"Course") or [None])[0]),
        style=unesc(style),
        skill=(tag(txt,"Skill Level") or [None])[0],
        focus=tag(txt,"Focus") or [],
        type=(tag(txt,"Type") or [None])[0],
        instructor=unesc(one(txt,"credits")),
    )
    episodes["%d:%d" % (s,e)] = {k:v for k,v in ep.items() if v not in (None,[],"")}
    counts[s] = counts.get(s,0)+1

seasons = {}
for sn, meta in SEASON_CAT.items():
    seasons[sn] = dict(title=season_titles.get(sn), episodes=counts.get(sn,0), **meta)

out = dict(show=676490, seasons=seasons, episodes=episodes)
open("%s/676490.index.json" % os.environ["SCRATCH"], "w").write(json.dumps(out, ensure_ascii=False, indent=1))
print("seasons:", len(seasons), "episodes:", len(episodes))
print("sample 10:1 =", json.dumps(episodes.get("10:1"), ensure_ascii=False))
print("sample 1:1  =", json.dumps(episodes.get("1:1"), ensure_ascii=False))
print("distinct styles:", sorted({v.get("style") for v in episodes.values() if v.get("style")}))
