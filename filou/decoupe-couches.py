# -*- coding: utf-8 -*-
"""Decoupe Filou en couches animables depuis une frame du metrage 3D.

Principe : on ne redessine RIEN. On tranche les pixels 3D existants en
morceaux (corps / tete / oreilles / paupieres) que le CSS anime ensuite.
Chaque morceau garde son rendu d'origine.

Sortie : filou/couches/*.png (+ un composite de controle)
Usage : python decoupe-couches.py <frame-rgba.png> [dossier-sortie]
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

src = os.path.abspath(sys.argv[1])
dst = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "couches")
os.makedirs(dst, exist_ok=True)

im = Image.open(src).convert("RGBA")
W, H = im.size

# --- reperes mesures sur le metrage (natif 1080x1920) --------------------
Y_COU = 930          # ligne de coupe tete / corps (sous le poitrail blanc)
PIVOT_TETE = (600, Y_COU)
# Bas du corps : coupe NETTE, jamais un fondu. Un fondu rend la blouse
# translucide et ca se voit (retour MiKL 2026-07-25) ; c'est le rebord
# dessine en CSS qui masque la coupe, comme un vrai appui.
Y_BAS = 1250

# polygones des oreilles, base large pour que la rotation ne decolle rien
OREILLE_G = [(452, 138), (556, 214), (600, 372), (614, 470),
             (470, 486), (378, 452), (372, 300)]
OREILLE_D = [(1014, 340), (1040, 430), (952, 566), (884, 660),
             (792, 596), (804, 486), (900, 396)]

# yeux : (centre_x, centre_y, demi_largeur, demi_hauteur) — mesures natives.
# L'oeil devient une FENETRE (overflow hidden) dans laquelle une paupiere
# coulisse : au repos elle est hors cadre, donc strictement invisible.
# On ne preleve plus de bande de fourrure (elle dupliquait les sourcils).
OEIL_G = (535, 578, 63, 63)
OEIL_D = (725, 635, 57, 52)


def masque_polygone(points, flou=2.5):
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).polygon(points, fill=255)
    return m.filter(ImageFilter.GaussianBlur(flou)) if flou > 0 else m


def masque_bande(y_coupe, flou=3.0, haut=True):
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    if haut:
        d.rectangle([0, 0, W, y_coupe], fill=255)
    else:
        d.rectangle([0, y_coupe, W, H], fill=255)
    return m.filter(ImageFilter.GaussianBlur(flou)) if flou > 0 else m


def applique(masque):
    """Retourne une copie de l'image ou l'alpha est multiplie par le masque."""
    out = im.copy()
    a = np.array(out.getchannel("A"), dtype=np.float32)
    a = a * (np.array(masque, dtype=np.float32) / 255.0)
    out.putalpha(Image.fromarray(a.astype(np.uint8)))
    return out


def recadre(img, marge=6):
    bb = img.getchannel("A").point(lambda v: 255 if v > 4 else 0).getbbox()
    if bb is None:
        return img, (0, 0)
    x0 = max(0, bb[0] - marge)
    y0 = max(0, bb[1] - marge)
    x1 = min(W, bb[2] + marge)
    y1 = min(H, bb[3] + marge)
    return img.crop((x0, y0, x1, y1)), (x0, y0)


# --- 1. les oreilles ----------------------------------------------------
# ⚠ meme piege que le cou : si la tete est amputee EXACTEMENT du polygone
# rendu dans l'oreille, le raccord flou laisse un lisere clair. L'oreille
# est donc DILATEE (elle deborde) et la tete n'est amputee que du polygone
# ERODE : l'oreille recouvre largement le trou, quelle que soit sa rotation.
def dilate(masque, px):
    """px > 0 : elargit le masque ; px < 0 : le retrecit."""
    f = ImageFilter.MaxFilter if px > 0 else ImageFilter.MinFilter
    taille = abs(int(px)) * 2 + 1
    out = masque
    while taille > 1:
        pas = min(9, taille if taille % 2 else taille - 1)
        out = out.filter(f(pas))
        taille -= pas - 1
    return out


mg_net = masque_polygone(OREILLE_G, flou=0)
md_net = masque_polygone(OREILLE_D, flou=0)
mg = dilate(mg_net, 10).filter(ImageFilter.GaussianBlur(2.0))
md = dilate(md_net, 10).filter(ImageFilter.GaussianBlur(2.0))
oreille_g = applique(mg)
oreille_d = applique(md)

# --- 2. la tete = au-dessus du cou, MOINS les oreilles (erodees) ---------
m_tete = np.array(masque_bande(Y_COU, haut=True), dtype=np.float32)
tg = np.array(dilate(mg_net, -6), np.float32) / 255.0
td = np.array(dilate(md_net, -6), np.float32) / 255.0
m_sans_oreilles = m_tete * (1 - tg) * (1 - td)
tete = applique(Image.fromarray(np.clip(m_sans_oreilles, 0, 255).astype(np.uint8)))

# --- 3. le corps = sous le cou, avec CHEVAUCHEMENT sous la tete ---------
# ⚠ deux bords flous complementaires ne se recomposent PAS a alpha 255 :
# ca laissait une couture claire en travers du poitrail. Le corps remonte
# donc de RECOUVREMENT px sous la tete, bord net : la tete le masque.
RECOUVREMENT = 90
m_corps = np.array(masque_bande(Y_COU - RECOUVREMENT, flou=0.0, haut=False), np.float32)
m_corps *= np.array(masque_bande(Y_BAS, flou=0.0, haut=True), np.float32) / 255.0
corps = applique(Image.fromarray(np.clip(m_corps, 0, 255).astype(np.uint8)))

# --- 4. teinte de paupiere : moyenne de la fourrure juste au-dessus de l'oeil
def teinte_paupiere(oeil):
    cx, cy, rx, ry = oeil
    haut = cy - ry - 34
    zone = np.array(im.crop((cx - rx // 2, haut, cx + rx // 2, haut + 22))
                    .convert("RGB"), dtype=np.float32)
    r, v, b = [int(round(c)) for c in zone.reshape(-1, 3).mean(axis=0)]
    return "#%02X%02X%02X" % (r, v, b)

# --- 5. export + geometrie ----------------------------------------------
# Les pieces sont exportees en WebP a EXPORT x la taille native : a l'ecran
# Filou fait ~200 px de large pour 1080 natifs, la moitie de resolution est
# donc encore 2,7x au-dessus du besoin. La geometrie reste en px NATIFS
# (le CSS repose les pieces a leur taille native, le navigateur agrandit).
EXPORT = 0.5
QUALITE = 92

pieces = {}
for nom, img in (("corps", corps), ("tete", tete),
                 ("oreille-g", oreille_g), ("oreille-d", oreille_d)):
    rec, origine = recadre(img)
    petit = rec.resize((max(1, round(rec.size[0] * EXPORT)),
                        max(1, round(rec.size[1] * EXPORT))), Image.LANCZOS)
    petit.save(os.path.join(dst, nom + ".webp"), quality=QUALITE, method=6)
    pieces[nom] = {"x": origine[0], "y": origine[1],
                   "w": rec.size[0], "h": rec.size[1]}

geo = {
    "natif": [W, H],
    "pivot_tete": PIVOT_TETE,
    "pieces": pieces,
    "yeux": {
        "g": {"cx": OEIL_G[0], "cy": OEIL_G[1], "rx": OEIL_G[2], "ry": OEIL_G[3],
              "teinte": teinte_paupiere(OEIL_G)},
        "d": {"cx": OEIL_D[0], "cy": OEIL_D[1], "rx": OEIL_D[2], "ry": OEIL_D[3],
              "teinte": teinte_paupiere(OEIL_D)},
    },
}

import json
with open(os.path.join(dst, "geometrie.json"), "w", encoding="utf-8") as f:
    json.dump(geo, f, indent=2, ensure_ascii=False)

# --- 6. composite de controle : les couches remises a leur place --------
ctrl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
for nom in ("corps", "tete", "oreille-g", "oreille-d"):
    p = pieces[nom]
    piece = Image.open(os.path.join(dst, nom + ".webp")).convert("RGBA")
    ctrl.alpha_composite(piece.resize((p["w"], p["h"]), Image.LANCZOS),
                         (p["x"], p["y"]))
ctrl.save(os.path.join(dst, "_controle-recompose.webp"), quality=88, method=6)

poids = sum(os.path.getsize(os.path.join(dst, n + ".webp"))
            for n in ("corps", "tete", "oreille-g", "oreille-d"))
print("couches ecrites dans", dst)
for k, v in pieces.items():
    print(f"  {k:10s} {v['w']}x{v['h']} @ ({v['x']},{v['y']})")
print(f"  poids des 4 pieces : {poids // 1024} Ko")
print("  yeux:", geo["yeux"])
