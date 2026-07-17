# -*- coding: utf-8 -*-
"""Gate de cadrage : rien ne doit toucher les bords, sur TOUTES les frames.

Verifie qu'aucun pixel non-magenta (le personnage) n'entre dans la bande
des bords haut / gauche / droite de l'image, sur chaque frame de la video.
Le bas est exclu : le corps y est volontairement ancre.

Usage : python gate-cadrage.py <video.mp4> [bande_px]
Code retour 0 = cadrage OK ; 1 = deborde (liste des frames fautives).
"""
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

video = os.path.abspath(sys.argv[1])
BANDE = int(sys.argv[2]) if len(sys.argv) > 2 else 6

travail = tempfile.mkdtemp(prefix="filou-gate-")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", video,
                os.path.join(travail, "fr-%04d.png")], check=True)
frames = sorted(f for f in os.listdir(travail) if f.endswith(".png"))

MAGENTA = np.array([255.0, 0.0, 255.0])
fautives = []
for f in frames:
    rgb = np.array(Image.open(os.path.join(travail, f)).convert("RGB"), dtype=np.float32)
    perso = np.abs(rgb - MAGENTA).sum(axis=2) > 160  # tolerance compression
    haut = perso[:BANDE, :].any()
    gauche = perso[:, :BANDE].any()
    droite = perso[:, -BANDE:].any()
    if haut or gauche or droite:
        cotes = [c for c, hit in (("haut", haut), ("gauche", gauche), ("droite", droite)) if hit]
        fautives.append((f, "+".join(cotes)))

if fautives:
    print(f"DEBORDE sur {len(fautives)}/{len(frames)} frames :")
    for f, c in fautives[:12]:
        print("  ", f, c)
    sys.exit(1)
print(f"CADRAGE OK — {len(frames)} frames, rien ne touche haut/gauche/droite (bande {BANDE}px)")
