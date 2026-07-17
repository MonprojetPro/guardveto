# -*- coding: utf-8 -*-
"""Gate de cadrage : le RENARD ne doit jamais toucher les bords.

Detecte les pixels du personnage lui-meme (fourrure orange / pelage et
blouse quasi blancs) dans la bande des bords haut / gauche / droite de
chaque frame — independant de la couleur du fond (magenta, prune, mur
visible...). Le bas est exclu : le corps y est volontairement ancre.
Le seuil : on tolere quelques pixels epars (bruit de compression), pas
une oreille ou une patte.

Usage : python gate-cadrage.py <video.mp4> [bande_px]
Code retour 0 = cadrage OK ; 1 = deborde (liste des frames fautives).
"""
import colorsys
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

video = os.path.abspath(sys.argv[1])
BANDE = int(sys.argv[2]) if len(sys.argv) > 2 else 6
SEUIL_PIXELS = 30  # en-deca : bruit ; au-dela : un vrai bout du renard


def pixels_renard(rgb):
    """Fourrure orange (teinte chaude saturee) OU pelage/blouse quasi blanc."""
    r = rgb[:, :, 0].astype(np.float32)
    g = rgb[:, :, 1].astype(np.float32)
    b = rgb[:, :, 2].astype(np.float32)
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    orange = (r > 140) & (r > g * 1.25) & (g > b * 1.1) & ((mx - mn) > 50)
    blanc = mn > 195
    return orange | blanc


travail = tempfile.mkdtemp(prefix="filou-gate-")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", video,
                os.path.join(travail, "fr-%04d.png")], check=True)
frames = sorted(f for f in os.listdir(travail) if f.endswith(".png"))

fautives = []
for f in frames:
    rgb = np.array(Image.open(os.path.join(travail, f)).convert("RGB"))
    perso = pixels_renard(rgb)
    haut = int(perso[:BANDE, :].sum())
    gauche = int(perso[:, :BANDE].sum())
    droite = int(perso[:, -BANDE:].sum())
    cotes = [c for c, n in (("haut", haut), ("gauche", gauche), ("droite", droite)) if n > SEUIL_PIXELS]
    if cotes:
        fautives.append((f, "+".join(cotes)))

if fautives:
    print(f"DEBORDE sur {len(fautives)}/{len(frames)} frames :")
    for f, c in fautives[:12]:
        print("  ", f, c)
    sys.exit(1)
print(f"CADRAGE OK — {len(frames)} frames, le renard ne touche jamais haut/gauche/droite (bande {BANDE}px)")
