# -*- coding: utf-8 -*-
"""Workflow CANVA : MP4 detoure par Canva (fond blanc uni) -> WebM alpha boucle.

Canva detoure en 3 secondes mais exporte en H.264 sans alpha, fond blanc.
On ne peut pas chroma-keyer le blanc (la blouse de Filou est blanche) :
on retire UNIQUEMENT le blanc CONNECTE AUX BORDS de l'image (flood fill),
la blouse a l'interieur de la silhouette est preservee.

Usage : python canva-vers-alpha.py <canva.mp4> <sortie.webm> [K] [filtre_vf]
  K         : images de fondu fin->debut pour la boucle invisible (defaut 14)
  filtre_vf : filtre ffmpeg d'extraction optionnel (ex. "crop=810:1880:0:20")

Etapes : extraction (fps natif) -> alpha par flood fill borders (cv2)
-> lissage temporel leger de l'alpha (mediane sur 5) -> fondu de boucle
(les K dernieres images se fondent dans les K premieres, depart a K)
-> WebM VP9 alpha au fps natif.
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image
from scipy import ndimage

video = os.path.abspath(sys.argv[1])
sortie = os.path.abspath(sys.argv[2])
K = int(sys.argv[3]) if len(sys.argv) > 3 else 14
filtre_vf = sys.argv[4] if len(sys.argv) > 4 else None

SEUIL_BLANC = 244  # en-deca, un pixel n'est plus considere comme fond

# fps natif (le reencodage doit le garder, sinon le mouvement rame)
probe = subprocess.run(
    ["ffprobe", "-v", "error", "-select_streams", "v:0",
     "-show_entries", "stream=r_frame_rate", "-of", "json", video],
    capture_output=True, text=True, check=True)
num, den = json.loads(probe.stdout)["streams"][0]["r_frame_rate"].split("/")
fps = round(int(num) / int(den))
print(f"fps natif : {fps}", flush=True)

travail = tempfile.mkdtemp(prefix="filou-canva-")
src = os.path.join(travail, "src")
out = os.path.join(travail, "out")
os.makedirs(src)
os.makedirs(out)

print("[1/4] extraction des images...", flush=True)
cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", video]
if filtre_vf:
    cmd += ["-vf", filtre_vf]
cmd += [os.path.join(src, "fr-%04d.png")]
subprocess.run(cmd, check=True)
frames = sorted(f for f in os.listdir(src) if f.endswith(".png"))
n = len(frames)
assert n > 2 * K, f"video trop courte ({n} images) pour K={K}"
print(f"      {n} images", flush=True)

print("[2/4] alpha par flood fill depuis les bords...", flush=True)


def calcule_alpha(rgb):
    """Fond = pixels quasi blancs CONNECTES au bord (la blouse est a l'abri)."""
    quasi_blanc = rgb.min(axis=2) >= SEUIL_BLANC
    # composantes connexes du quasi-blanc ; celles qui touchent un bord = fond
    labels, _ = ndimage.label(quasi_blanc)
    bord = np.unique(np.concatenate([
        labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]]))
    fond = np.isin(labels, bord[bord != 0])
    alpha = np.where(fond, 0.0, 255.0)
    # plume d'1 px : adoucit la decoupe sans manger les moustaches
    return np.clip(ndimage.gaussian_filter(alpha, sigma=0.7), 0, 255).astype(np.uint8)


for i, f in enumerate(frames):
    chemin = os.path.join(src, f)
    rgb = np.array(Image.open(chemin).convert("RGB"))
    rgba = np.dstack([rgb, calcule_alpha(rgb)])
    Image.fromarray(rgba).save(chemin)
    if i % 40 == 0:
        print(f"      {i}/{n}", flush=True)

print("[3/4] lissage temporel de l'alpha (mediane sur 5)...", flush=True)
DEMI = 2


def alpha_de(idx):
    return np.array(Image.open(os.path.join(src, frames[idx])))[:, :, 3]


lisses = []
for t in range(n):
    lo, hi = max(0, t - DEMI), min(n, t + DEMI + 1)
    fenetre = np.stack([alpha_de(k) for k in range(lo, hi)])
    lisses.append(np.median(fenetre, axis=0).astype(np.uint8))
for t in range(n):
    rgba = np.array(Image.open(os.path.join(src, frames[t])))
    rgba[:, :, 3] = lisses[t]
    Image.fromarray(rgba).save(os.path.join(src, frames[t]))

print("[4/4] fondu de boucle + WebM VP9 alpha...", flush=True)


def charge(i):
    return np.array(Image.open(os.path.join(src, frames[i])), dtype=np.float32)


idx = 0
for i in range(K, n - K):
    os.link(os.path.join(src, frames[i]), os.path.join(out, f"fr-{idx:04d}.png"))
    idx += 1
for j in range(K):
    w = (j + 1) / (K + 1)
    mel = (1 - w) * charge(n - K + j) + w * charge(j)
    Image.fromarray(mel.astype(np.uint8)).save(os.path.join(out, f"fr-{idx:04d}.png"))
    idx += 1

subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps),
                "-i", os.path.join(out, "fr-%04d.png"),
                "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
                "-b:v", "0", "-crf", "32", "-auto-alt-ref", "0", "-an",
                sortie], check=True)
print(f"TERMINE -> {sortie} ({os.path.getsize(sortie)//1024} Ko, {idx} images a {fps} i/s)")
