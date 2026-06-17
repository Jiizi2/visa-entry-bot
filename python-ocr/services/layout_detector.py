"""
Deteksi otomatis versi layout paspor Indonesia berdasarkan karakteristik gambar.
"""
from __future__ import annotations

try:
    import cv2
except ImportError:
    cv2 = None

import numpy as np


def detect_passport_layout_version(image: object) -> str:
    """
    Mengembalikan string versi layout yang terdeteksi.
    Nilai yang mungkin: "indonesia_default", "indonesia_pre2014"
    Default: "indonesia_default" jika tidak dapat ditentukan.
    """
    if cv2 is None or image is None:
        return "indonesia_default"
    
    # Cek apakah ada chip indicator (paspor e-passport post-2014 memiliki chip symbol)
    # Estimasi: chip biasanya ada di area kiri atas dalam 20% pertama gambar
    # Deteksi berbasis warna hijau yang dominan di area tertentu
    if _has_biometric_indicator(image):
        return "indonesia_default"  # Post-2014
    
    return "indonesia_default"  # Default ke layout baru jika tidak yakin


def _has_biometric_indicator(image: object) -> bool:
    """
    Heuristik sederhana: paspor Indonesia post-2014 memiliki logo biometrik
    (kepala orang dengan garis gelombang di bawah) di area tertentu.
    Ini deteksi kasar berbasis brightness/color pattern.
    """
    if image is None or cv2 is None or not hasattr(image, "shape"):
        return True  # Default: asumsikan modern
    height, width = image.shape[:2]
    if height < 100 or width < 100:
        return True
    # Area cover page biasanya hijau tua untuk paspor Indonesia modern
    # Deteksi presisi memerlukan sampel — implementasikan heuristik minimal dulu
    # dan kalibrasi dengan golden dataset
    return True  # Placeholder: selalu return True (gunakan layout default)
