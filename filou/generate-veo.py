# -*- coding: utf-8 -*-
"""
Génération des boucles vidéo de Filou via l'API Gemini (Veo).
Usage :
  python generate-veo.py --scene accroche-rebord [--model veo-3.0-fast-generate-001] [--image "filou avatar de base.png"]
  python generate-veo.py --list

La clé API est lue dans (ordre) : $GEMINI_API_KEY, puis le niveau User
du registre Windows (HKCU/Environment) - pas besoin de redemarrer le
terminal après un setx.

Sortie : filou/veo-out/<scene>-<n>.mp4 (à passer ensuite au pipeline
de détourage rembg -> WebM alpha, cf. pipeline-detourage.py).
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "veo-out")
PROMPTS_FILE = os.path.join(HERE, "prompts-veo.json")
API_BASE = "https://generativelanguage.googleapis.com/v1beta"


def get_api_key():
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key.strip()
    # setx écrit au niveau User sans mettre à jour les process ouverts :
    # on sonde directement le registre (leçon token-env-non-herite-process).
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
            val, _ = winreg.QueryValueEx(k, "GEMINI_API_KEY")
            if val:
                return val.strip()
    except OSError:
        pass
    sys.exit("GEMINI_API_KEY introuvable (ni env, ni registre User). "
             "Créer la clé sur aistudio.google.com puis : setx GEMINI_API_KEY \"...\"")


def http_json(url, payload=None, timeout=120):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json"},
                                 method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        sys.exit("HTTP %s sur %s\n%s" % (e.code, url.split("?")[0], body[:2000]))


def load_scenes():
    with open(PROMPTS_FILE, encoding="utf-8") as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scene", help="nom de la scène (cf. --list)")
    ap.add_argument("--list", action="store_true", help="lister les scènes")
    ap.add_argument("--model", default="veo-3.1-fast-generate-preview",
                    help="veo-3.1-fast-generate-preview (éco) | veo-3.1-generate-preview | veo-3.1-lite-generate-preview")
    ap.add_argument("--image", help="image de première frame (PNG) pour ancrer le personnage")
    ap.add_argument("--lastframe", help="image imposée comme DERNIÈRE frame (boucle parfaite, cf. tape-tablette v2)")
    ap.add_argument("--refimage", help="image de RÉFÉRENCE d'identité (asset) — garde le personnage sans imposer la pose ; incompatible negativePrompt (retiré automatiquement)")
    ap.add_argument("--prompt", help="prompt libre (à la place d'une scène du pack)")
    ap.add_argument("--aspect", default="9:16", help="9:16 (défaut, comme filou-attente) ou 16:9")
    args = ap.parse_args()

    scenes = load_scenes()
    if args.list:
        for name, sc in scenes.items():
            print("%-20s %s" % (name, sc["prompt"][:95] + "…"))
        return

    if not args.scene and not args.prompt:
        sys.exit("--scene <nom> ou --prompt requis (voir --list)")

    if args.prompt:
        prompt, negative, scene_name = args.prompt, scenes.get("_negative", ""), "libre"
    else:
        sc = scenes[args.scene]
        prompt = sc["prompt"]
        negative = sc.get("negative", scenes.get("_negative", ""))
        scene_name = args.scene

    key = get_api_key()
    os.makedirs(OUT_DIR, exist_ok=True)

    def img_payload(path):
        with open(path, "rb") as f:
            return {
                "bytesBase64Encoded": base64.b64encode(f.read()).decode("ascii"),
                "mimeType": "image/png",
            }

    instance = {"prompt": prompt}
    if args.image:
        instance["image"] = img_payload(args.image)
    if args.lastframe:
        instance["lastFrame"] = img_payload(args.lastframe)
    if args.refimage:
        instance["referenceImages"] = [{"image": img_payload(args.refimage), "referenceType": "asset"}]
        negative = ""  # incompatible avec referenceImages (HTTP 400)
    parameters = {"aspectRatio": args.aspect}
    # NB : generateAudio n'est pas supporté par veo-3.1-*-preview (HTTP 400) ;
    # couper le son en aval : ffmpeg -an sur le MP4 livré.
    if negative:
        parameters["negativePrompt"] = negative
    payload = {
        "instances": [instance],
        "parameters": parameters,
    }

    print("Lancement Veo | modele %s | scene %s" % (args.model, scene_name))
    op = http_json("%s/models/%s:predictLongRunning?key=%s" % (API_BASE, args.model, key), payload)
    op_name = op["name"]
    print("Operation :", op_name)

    while True:
        time.sleep(10)
        st = http_json("%s/%s?key=%s" % (API_BASE, op_name, key))
        if st.get("done"):
            break
        print("  ... generation en cours")

    if "error" in st:
        sys.exit("Erreur Veo : " + json.dumps(st["error"], ensure_ascii=False))

    resp = st.get("response", {})
    samples = (resp.get("generateVideoResponse", {}).get("generatedSamples")
               or resp.get("generatedVideos") or [])
    if not samples:
        sys.exit("Réponse sans vidéo :\n" + json.dumps(resp, ensure_ascii=False)[:2000])

    for i, s in enumerate(samples):
        uri = (s.get("video") or {}).get("uri") or s.get("uri")
        if not uri:
            print("échantillon %d sans uri : %s" % (i, json.dumps(s)[:300]))
            continue
        sep = "&" if "?" in uri else "?"
        out = os.path.join(OUT_DIR, "%s-%d.mp4" % (scene_name, i))
        print("Telechargement ->", out)
        urllib.request.urlretrieve(uri + sep + "key=" + key, out)
    print("Terminé. Prochaine étape : pipeline-detourage.py sur le MP4 retenu.")


if __name__ == "__main__":
    main()
