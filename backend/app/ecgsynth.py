"""Synthetic single-lead ECG (for demo data and the app simulator): normal sinus rhythm or AFib."""
import math
import random


def synth_ecg(seconds: float = 10, fs: int = 125, afib: bool = False, bpm: float = 72, seed: int = 0) -> list[float]:
    rng = random.Random(seed)
    n = int(seconds * fs)
    x = [0.0] * n

    def bump(center: float, amp: float, width: float):
        c = int(center * fs)
        w = max(1, int(width * fs * 3))
        for i in range(max(0, c - w), min(n, c + w)):
            x[i] += amp * math.exp(-((i / fs - center) ** 2) / (2 * width ** 2))

    t = 0.3
    rr0 = 60 / bpm
    while t < seconds:
        if not afib:
            bump(t - 0.16, 0.15, 0.025)                          # P wave
        bump(t - 0.02, -0.12, 0.008)                             # Q
        bump(t, 1.2, 0.012)                                      # R
        bump(t + 0.025, -0.25, 0.01)                             # S
        bump(t + 0.25, 0.3, 0.045)                               # T
        t += rng.uniform(0.45, 1.05) * (rr0 / 0.75) if afib else rr0 * (1 + rng.gauss(0, 0.03))
    for i in range(n):
        x[i] += 0.03 * rng.gauss(0, 1) + 0.08 * math.sin(2 * math.pi * 0.25 * i / fs)
        if afib:                                                 # fibrillatory f-waves
            x[i] += 0.06 * math.sin(2 * math.pi * 6.3 * i / fs + rng.gauss(0, 0.3))
    return [round(v, 4) for v in x]
