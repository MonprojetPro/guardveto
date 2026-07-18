# -*- coding: utf-8 -*-
"""Cuit les fondus d'integration DANS l'alpha d'un WebM (au lieu de masks CSS).

Pourquoi : les mask-image CSS sur une <video> composited laissent passer
une ligne de bord a la limite de l'overflow (bug compositor constate sur
m1-planning, 2026-07-18). En cuisant le fondu dans l'asset, le rendu est
identique sur tous les navigateurs et aucune ligne ne peut apparaitre.

Usage : python applique-fondu-alpha.py <in.webm> <out.webm> \
          <y_debut> <y_fin> <x_debut> <x_fin>
  y_debut/y_fin : fondu vertical en px natifs (alpha 1 -> 0), 0 au-dela
  x_debut/x_fin : fondu lateral en px natifs (alpha 1 -> 0), 0 au-dela
                  (passer 0 0 pour ne pas appliquer de fondu lateral)
Le fondu final = produit des deux (equivalent mask-composite: intersect).
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

entree = os.path.abspath(sys.argv[1])
sortie = os.path.abspath(sys.argv[2])
y0, y1 = int(sys.argv[3]), int(sys.argv[4])
x0, x1 = int(sys.argv[5]), int(sys.argv[6])

probe = subprocess.run(
    ["ffprobe", "-v", "error", "-select_streams", "v:0",
     "-show_entries", "stream=r_frame_rate", "-of", "json", entree],
    capture_output=True, text=True, check=True)
num, den = json.loads(probe.stdout)["streams"][0]["r_frame_rate"].split("/")
fps = round(int(num) / int(den))

travail = tempfile.mkdtemp(prefix="filou-fondu-")
src = os.path.join(travail, "src")
os.makedirs(src)

print("[1/3] extraction (decodeur vp9 avec alpha)...", flush=True)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-c:v", "libvpx-vp9",
                "-i", entree, os.path.join(src, "fr-%04d.png")], check=True)
frames = sorted(f for f in os.listdir(src) if f.endswith(".png"))
n = len(frames)
print(f"      {n} images a {fps} i/s", flush=True)

print("[2/3] fondu de l'alpha...", flush=True)
im0 = np.array(Image.open(os.path.join(src, frames[0])))
H, W = im0.shape[:2]
ys = np.arange(H, dtype=np.float32)
fondu_v = np.clip((y1 - ys) / max(1, (y1 - y0)), 0, 1)
xs = np.arange(W, dtype=np.float32)
if x1 > 0:
    fondu_h = np.clip((x1 - xs) / max(1, (x1 - x0)), 0, 1)
else:
    fondu_h = np.ones_like(xs)
masque = fondu_v[:, None] * fondu_h[None, :]

for i, f in enumerate(frames):
    chemin = os.path.join(src, f)
    rgba = np.array(Image.open(chemin))
    rgba[:, :, 3] = (rgba[:, :, 3].astype(np.float32) * masque).astype(np.uint8)
    Image.fromarray(rgba).save(chemin)
    if i % 40 == 0:
        print(f"      {i}/{n}", flush=True)

print("[3/3] reencodage VP9 alpha...", flush=True)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps),
                "-i", os.path.join(src, "fr-%04d.png"),
                "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
                "-b:v", "0", "-crf", "32", "-auto-alt-ref", "0", "-an",
                sortie], check=True)
print(f"TERMINE -> {sortie} ({os.path.getsize(sortie)//1024} Ko)")
