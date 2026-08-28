#!/usr/bin/env python3
import argparse, json, os, re, urllib.parse, urllib.request
from pathlib import Path

def api(url, key, data=None):
    req=urllib.request.Request(url,data=None if data is None else json.dumps(data).encode(),headers={"xi-api-key":key,"Content-Type":"application/json"})
    with urllib.request.urlopen(req,timeout=180) as r: return r.read(),dict(r.headers)

def clean(s): return re.sub(r"\s+"," ",re.sub(r"(?:\*\*|__|[*_#>`])","",s)).strip()

p=argparse.ArgumentParser(); p.add_argument("--draft",type=Path,required=True); p.add_argument("--output",type=Path,required=True); a=p.parse_args()
key=os.environ["ELEVENLABS_API_KEY"]; draft=json.loads(a.draft.read_text())
raw,_=api("https://api.elevenlabs.io/v2/voices?page_size=100&search="+urllib.parse.quote("Will - Relaxed Optimist"),key)
voices=json.loads(raw).get("voices",[]); voice=next((v for v in voices if v.get("name")=="Will - Relaxed Optimist"),None)
if not voice: raise SystemExit("Will - Relaxed Optimist voice was not found")
settings_raw,_=api(f"https://api.elevenlabs.io/v1/voices/{voice['voice_id']}/settings",key); settings=json.loads(settings_raw)
paras=[clean(x) for x in draft["body"].split("\n\n") if clean(x)]
text="\n\n".join([draft["title"],draft["description"],*paras[:3]])[:2400]
audio,_=api(f"https://api.elevenlabs.io/v1/text-to-speech/{voice['voice_id']}?output_format=mp3_44100_128",key,{"text":text,"model_id":"eleven_multilingual_v2","voice_settings":settings})
a.output.mkdir(parents=True,mode=0o700); target=a.output/"sample-es.mp3"; target.write_bytes(audio); target.chmod(0o600)
(a.output/"summary.json").write_text(json.dumps({"voice":voice,"settings":settings,"model":"eleven_multilingual_v2","characters":len(text)},indent=2)+"\n")
print(json.dumps({"voice_id":voice["voice_id"],"voice":voice["name"],"settings":settings,"characters":len(text),"bytes":len(audio)}))
