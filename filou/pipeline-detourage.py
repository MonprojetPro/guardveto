"""Pipeline Filou : MP4 (fond uni) -> WebM transparent.

Usage : python pipeline-detourage.py <video.mp4> <sortie.webm> [filtre_vf]
  filtre_vf : filtre ffmpeg d'extraction (defaut : crop=640:720:340:0,
  adapte aux videos paysage 1280x720 ; pour un portrait 1080x1920 utiliser
  par ex. "scale=540:960").

Etapes : extraction des images (ffmpeg) -> detourage IA
par image (rembg isnet, ecrit sur disque au fil de l'eau) -> lissage temporel
de l'alpha (mediane glissante sur 7 images, en flux : tue les vacillements
sans charger la video en memoire) -> reassemblage VP9 alpha (ffmpeg).
"""
import os
import subprocess
import sys
import tempfile
import time

import numpy as np
from PIL import Image
from rembg import new_session, remove

video = os.path.abspath(sys.argv[1])
sortie = os.path.abspath(sys.argv[2])
filtre_vf = sys.argv[3] if len(sys.argv) > 3 else 'crop=640:720:340:0'

travail = tempfile.mkdtemp(prefix='filou-pipe-')
frames_dir = os.path.join(travail, 'frames')
mattes_dir = os.path.join(travail, 'mattes')
final_dir = os.path.join(travail, 'final')
for d in (frames_dir, mattes_dir, final_dir):
    os.makedirs(d)

print(f'[1/4] extraction des images de {os.path.basename(video)}...', flush=True)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', video,
                '-vf', filtre_vf,
                os.path.join(frames_dir, 'fr-%04d.png')], check=True)
frames = sorted(f for f in os.listdir(frames_dir) if f.endswith('.png'))
n = len(frames)
print(f'      {n} images', flush=True)

print('[2/4] detourage IA (isnet-general-use), ecriture au fil de l\'eau...', flush=True)
session = new_session('isnet-general-use')
t0 = time.time()
for i, f in enumerate(frames):
    img = Image.open(os.path.join(frames_dir, f))
    remove(img, session=session).save(os.path.join(mattes_dir, f))
    if i % 40 == 0:
        print(f'      {i}/{n} ({time.time()-t0:.0f}s)', flush=True)

print('[3/4] lissage temporel de l\'alpha (mediane sur 7, en flux)...', flush=True)
DEMI = 3  # fenetre = 2*DEMI+1 = 7 images


def alpha(idx):
    a = np.array(Image.open(os.path.join(mattes_dir, frames[idx])))[:, :, 3]
    return a


for t in range(n):
    lo, hi = max(0, t - DEMI), min(n, t + DEMI + 1)
    fenetre = np.stack([alpha(k) for k in range(lo, hi)])
    rgba = np.array(Image.open(os.path.join(mattes_dir, frames[t])))
    rgba[:, :, 3] = np.median(fenetre, axis=0).astype(np.uint8)
    Image.fromarray(rgba).save(os.path.join(final_dir, frames[t]))
    if t % 60 == 0:
        print(f'      {t}/{n}', flush=True)

print('[4/4] assemblage WebM VP9 alpha...', flush=True)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '24',
                '-i', os.path.join(final_dir, 'fr-%04d.png'),
                '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
                '-b:v', '0', '-crf', '32', '-auto-alt-ref', '0', '-an',
                sortie], check=True)
print(f'TERMINE -> {sortie} ({os.path.getsize(sortie)//1024} Ko, {round(time.time()-t0)} s au total)')
