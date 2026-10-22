"""Read and write PNG files with the Python standard library only (no Pillow needed).

read_la(path)  -> (width, height, [(luminance, alpha), ...])   any non-interlaced PNG
read_rgba(path) -> (width, height, bytes RGBA)
write_rgba(path, width, height, rgba_bytes)
"""
import struct
import zlib

_CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}


def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def read_rgba(path):
    with open(path, 'rb') as f:
        data = f.read()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError(f'{path}: not a PNG file')
    pos, idat, palette, trns = 8, [], None, None
    while pos < len(data):
        length, kind = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b'IHDR':
            w, h, depth, ctype, _, _, interlace = struct.unpack('>IIBBBBB', body)
        elif kind == b'PLTE':
            palette = body
        elif kind == b'tRNS':
            trns = body
        elif kind == b'IDAT':
            idat.append(body)
        elif kind == b'IEND':
            break
    if interlace:
        raise ValueError(f'{path}: interlaced PNGs are not supported')
    ch = _CHANNELS[ctype]
    bits = depth * ch
    stride = (w * bits + 7) // 8
    bpp = max(1, bits // 8)
    raw = zlib.decompress(b''.join(idat))
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        ft = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        if ft == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 255
        elif ft == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif ft == 3:
            for x in range(stride):
                left = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((left + prev[x]) >> 1)) & 255
        elif ft == 4:
            for x in range(stride):
                left = line[x - bpp] if x >= bpp else 0
                up_left = prev[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + _paeth(left, prev[x], up_left)) & 255
        rows.append(line)
        prev = line
    out = bytearray(w * h * 4)
    maxv = (1 << depth) - 1
    for y, line in enumerate(rows):
        for x in range(w):
            if depth == 8:
                s = line[x * ch:x * ch + ch]
            elif depth == 16:
                s = line[x * ch * 2:x * ch * 2 + ch * 2:2]
            else:  # 1, 2, 4 bit gray or palette
                bitpos = x * depth
                s = [(line[bitpos >> 3] >> (8 - depth - (bitpos & 7))) & maxv]
            if ctype == 0:
                v = s[0] * 255 // maxv if depth < 8 else s[0]
                px = (v, v, v, 255)
            elif ctype == 2:
                px = (s[0], s[1], s[2], 255)
            elif ctype == 3:
                k = s[0]
                px = (palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2], trns[k] if trns and k < len(trns) else 255)
            elif ctype == 4:
                px = (s[0], s[0], s[0], s[1])
            else:
                px = (s[0], s[1], s[2], s[3])
            o = (y * w + x) * 4
            out[o:o + 4] = bytes(px)
    return w, h, bytes(out)


def read_la(path):
    """Luminance + alpha per pixel (luminance as Pillow's convert('L') computes it)."""
    w, h, rgba = read_rgba(path)
    px = []
    for i in range(0, len(rgba), 4):
        r, g, b, a = rgba[i:i + 4]
        px.append(((r * 299 + g * 587 + b * 114) // 1000, a))
    return w, h, px


def write_rgba(path, w, h, rgba):
    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xFFFFFFFF)
    raw = b''.join(b'\0' + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
