"""Boucle invisible SANS fantome : trouve le point de bouclage naturel.

Usage : python boucle-naturelle.py <entree.webm> <sortie.webm> [frames_fantome_a_retirer]

Methode : cherche la paire d'images (i tot, j tard) la plus RESSEMBLANTE
(difference pixel minimale sur miniature RGBA) et coupe la video de i a j-1 :
le passage j-1 -> i est alors quasi identique a une vraie continuite.
Un micro-fondu de 3 images lisse le residu (imperceptible car les poses
sont deja presque identiques).
"""
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

entree = os.path.abspath(sys.argv[1])
sortie = os.path.abspath(sys.argv[2])
drop_fin = int(sys.argv[3]) if len(sys.argv) > 3 else 0

travail = tempfile.mkdtemp(prefix='filou-nat-')
src = os.path.join(travail, 'src')
out = os.path.join(travail, 'out')
os.makedirs(src)
os.makedirs(out)

print('[1/4] extraction...', flush=True)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-c:v', 'libvpx-vp9',
                '-i', entree, os.path.join(src, 'fr-%04d.png')], check=True)
frames = sorted(f for f in os.listdir(src) if f.endswith('.png'))
if drop_fin:
    frames = frames[:-drop_fin]  # retire les images fantomes d'un fondu precedent
n = len(frames)
print(f'      {n} images utiles', flush=True)

print('[2/4] recherche du point de bouclage naturel...', flush=True)
minis = []
for f in frames:
    im = Image.open(os.path.join(src, f)).convert('RGBA').resize((68, 120))
    minis.append(np.asarray(im, dtype=np.float32))

DUREE_MIN = int(n * 0.45)  # la boucle doit garder au moins ~45 % de la video
best = (1e18, 0, n)
for i in range(0, min(90, n // 3)):
    for j in range(i + DUREE_MIN, n):
        d = float(np.mean(np.abs(minis[i] - minis[j])))
        if d < best[0]:
            best = (d, i, j)
score, i0, j0 = best
print(f'      meilleur point : image {i0} -> {j0} (ecart moyen {score:.2f}/255, duree {j0-i0} img = {(j0-i0)/24:.1f} s)', flush=True)

print('[3/4] assemblage avec micro-fondu (3 images)...', flush=True)
K = 3


def charge(k):
    return np.array(Image.open(os.path.join(src, frames[k])), dtype=np.float32)


idx = 0
for k in range(i0, j0 - K):
    os.link(os.path.join(src, frames[k]), os.path.join(out, f'fr-{idx:04d}.png'))
    idx += 1
for j in range(K):
    w = (j + 1) / (K + 1)
    mel = (1 - w) * charge(j0 - K + j) + w * charge(i0 + j)
    Image.fromarray(mel.astype(np.uint8)).save(os.path.join(out, f'fr-{idx:04d}.png'))
    idx += 1

print('[4/4] reencodage VP9 alpha...', flush=True)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '24',
                '-i', os.path.join(out, 'fr-%04d.png'),
                '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
                '-b:v', '0', '-crf', '34', '-auto-alt-ref', '0', '-an',
                sortie], check=True)
print(f'TERMINE -> {sortie} ({os.path.getsize(sortie)//1024} Ko, {idx} images, {idx/24:.1f} s)')
