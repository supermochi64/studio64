"""Audio for the trailer edit: sample loading, the game's own sound (audio tap of a pass), an event
mixer and the master (-14 LUFS integrated, true peak under -1 dBTP)."""
import subprocess, json, numpy as np, soxr
SR = 48000
FPS = 30

def load(path, sr=SR):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(sr), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).copy()

def repitch(x, semis=0.0, rate=None):
    r = rate if rate is not None else 2 ** (semis / 12)
    if abs(r - 1) < 1e-4:
        return x
    return soxr.resample(x, SR * r, SR).astype(np.float32)

class GameAudio:
    """A pass's audio tap: exactly one game frame of sound per frame (s16 stereo, 32 kHz nominal)."""
    def __init__(self, pass_dir):
        raw = np.fromfile(f'{pass_dir}/audio.s16le', np.int16).reshape(-1, 2).astype(np.float32) / 32768
        counts = json.load(open(f'{pass_dir}/audio_frames.json'))
        self.starts = np.concatenate([[0], np.cumsum(counts)]).astype(int)
        # one game frame = 1/30 s: resample the whole tap from its real rate (~32160) to 48 kHz
        per = np.mean(counts[1:]) if len(counts) > 1 else 1072
        self.rate = per * FPS
        self.x = soxr.resample(raw, self.rate, SR).astype(np.float32)
        self.k = SR / self.rate
    def span(self, f0, f1):
        """sound of source frames [f0, f1) at 48 kHz"""
        a = int(self.starts[max(0, f0)] * self.k); b = int(self.starts[min(len(self.starts) - 1, f1)] * self.k)
        return self.x[a:b]

class Mix:
    def __init__(self, seconds):
        self.n = int(seconds * SR) + SR
        self.bus = {}
    def add(self, bus, x, t, gain_db=0.0, fade_in=0.0, fade_out=0.004):
        b = self.bus.setdefault(bus, np.zeros((self.n, 2), np.float32))
        x = x.copy()
        if fade_in > 0:
            k = min(len(x), int(fade_in * SR)); x[:k] *= np.linspace(0, 1, k)[:, None]
        if fade_out > 0:
            k = min(len(x), int(fade_out * SR)); x[-k:] *= np.linspace(1, 0, k)[:, None]
        i = int(round(t * SR))
        if i < 0:
            x = x[-i:]; i = 0
        j = min(self.n, i + len(x))
        b[i:j] += x[:j - i] * (10 ** (gain_db / 20))
    def render(self, gains=None, duck=None):
        gains = gains or {}
        out = np.zeros((self.n, 2), np.float32)
        for k, b in self.bus.items():
            out += b * (10 ** (gains.get(k, 0) / 20))
        return out

def master(x, lufs=-14.0, ceiling_db=-1.2):
    import pyloudnorm as pyln
    meter = pyln.Meter(SR)
    # gentle glue: soft knee saturation, then gain to the target, then a look-ahead peak limiter
    l = meter.integrated_loudness(x.astype(np.float64))
    x = x * (10 ** ((lufs - l) / 20))
    for _ in range(4):
        x = limit(x, ceiling_db)
        l = meter.integrated_loudness(x.astype(np.float64))
        if abs(l - lufs) < 0.15:
            break
        x = x * (10 ** ((lufs - l) / 20))
    x = limit(x, ceiling_db)
    return x, meter.integrated_loudness(x.astype(np.float64))

def limit(x, ceiling_db=-1.2, look=0.003, release=0.08):
    """look-ahead peak limiter on 4x oversampled peaks (true-peak-ish)."""
    c = 10 ** (ceiling_db / 20)
    up = soxr.resample(x, SR, SR * 4)
    pk = np.abs(up).max(1).reshape(-1, 4).max(1)[:len(x)]
    pk = np.pad(pk, (0, len(x) - len(pk)), constant_values=0)
    g = np.minimum(1.0, c / np.maximum(pk, 1e-9))
    la = int(look * SR)
    # look-ahead: the gain reaches its minimum before the peak, then recovers smoothly
    gmin = np.minimum.accumulate(np.concatenate([g[la:], np.ones(la)])[::-1])[::-1] if False else None
    from scipy.ndimage import minimum_filter1d
    g2 = minimum_filter1d(g, size=2 * la + 1, origin=0)
    rel = np.exp(-1 / (release * SR))
    out = np.empty_like(g2); cur = 1.0
    for i in range(len(g2)):   # fast attack (already looked ahead), smooth release
        cur = g2[i] if g2[i] < cur else cur * rel + g2[i] * (1 - rel)
        out[i] = cur
    return (x * out[:, None]).astype(np.float32)
