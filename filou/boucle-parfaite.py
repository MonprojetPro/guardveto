"""Rend une boucle WebM alpha invisible : fond enchaine la fin dans le debut.

Usage : python boucle-parfaite.py <entree.webm> <sortie.webm> [K]
  K = nombre d'images de fondu (defaut 14, soit ~0,6 s a 24 i/s)

Methode : les K dernieres images sont melangees progressivement avec les K
premieres (couleur ET alpha), puis la video demarre a l'image K -> au point de
bouclage, la derniere image fondue == l'image de depart : aucun saut.
"""
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

entree = os.path.abspath(sys.argv[1])
sortie = os.path.abspath(sys.argv[2])
K = int(sys.argv[3]) if len(sys.argv) > 3 else 14

travail = tempfile.mkdtemp(prefix='filou-loop-')
src = os.path.join(travail, 'src')
out = os.path.join(travail, 'out')
os.makedirs(src)
os.makedirs(out)

print('[1/3] extraction (alpha preserve)...', flush=True)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-c:v', 'libvpx-vp9',
                '-i', entree, os.path.join(src, 'fr-%04d.png')], check=True)
frames = sorted(f for f in os.listdir(src) if f.endswith('.png'))
n = len(frames)
assert n > 2 * K, f'video trop courte ({n} images) pour K={K}'
print(f'      {n} images, fondu sur {K}', flush=True)

print('[2/3] fondu fin->debut...', flush=True)


def charge(i):
    return np.array(Image.open(os.path.join(src, frames[i])), dtype=np.float32)


idx = 0
# la video demarre a l'image K (les K premieres servent de cible de fondu)
for i in range(K, n - K):
    os.link(os.path.join(src, frames[i]), os.path.join(out, f'fr-{idx:04d}.png'))
    idx += 1
for j in range(K):
    w = (j + 1) / (K + 1)
    mel = (1 - w) * charge(n - K + j) + w * charge(j)
    Image.fromarray(mel.astype(np.uint8)).save(os.path.join(out, f'fr-{idx:04d}.png'))
    idx += 1

print('[3/3] reencodage VP9 alpha...', flush=True)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '24',
                '-i', os.path.join(out, 'fr-%04d.png'),
                '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
                '-b:v', '0', '-crf', '34', '-auto-alt-ref', '0', '-an',
                sortie], check=True)
print(f'TERMINE -> {sortie} ({os.path.getsize(sortie)//1024} Ko, {idx} images)')
