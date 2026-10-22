#!/usr/bin/env python3
"""Nintendo GameCube containers: Yaz0 decompression and RARC archives."""
import struct


def yaz0(data):
    if data[:4] != b'Yaz0':
        return data
    size = struct.unpack('>I', data[4:8])[0]
    out = bytearray(size)
    src, dst = 16, 0
    n = len(data)
    while dst < size and src < n:
        code = data[src]; src += 1
        for bit in range(7, -1, -1):
            if dst >= size or src >= n:
                break
            if code & (1 << bit):
                out[dst] = data[src]; src += 1; dst += 1
            else:
                b1, b2 = data[src], data[src + 1]; src += 2
                dist = ((b1 & 0x0f) << 8 | b2) + 1
                if b1 >> 4:
                    length = (b1 >> 4) + 2
                else:
                    length = data[src] + 0x12; src += 1
                start = dst - dist
                if dist >= length:
                    out[dst:dst + length] = out[start:start + length]
                else:
                    for k in range(length):
                        out[dst + k] = out[start + k]
                dst += length
    return bytes(out)


def rarc(data):
    """{path: bytes} for every file in a RARC archive."""
    assert data[:4] == b'RARC', data[:4]
    data_off = struct.unpack('>I', data[0x0c:0x10])[0] + 0x20
    info = 0x20
    num_nodes, node_off, num_entries, entry_off, str_size, str_off = struct.unpack('>IIIIII', data[info:info + 24])
    node_off += info; entry_off += info; str_off += info
    def s(o):
        return data[str_off + o:data.index(b'\0', str_off + o)].decode('shift_jis', 'replace')
    nodes = []
    for i in range(num_nodes):
        o = node_off + i * 16
        _, name_off, _, count, first = struct.unpack('>4sIHHI', data[o:o + 16])
        nodes.append((s(name_off), count, first))
    out = {}
    def walk(ni, prefix):
        name, count, first = nodes[ni]
        for e in range(first, first + count):
            o = entry_off + e * 20
            _, _, flags_name, doff, dsize = struct.unpack('>HHIII', data[o:o + 16])
            flags, nameo = flags_name >> 24, flags_name & 0xffffff
            n = s(nameo)
            if n in ('.', '..'):
                continue
            if flags & 0x02:  # directory: doff is the node index
                walk(doff, f'{prefix}{n}/')
            else:
                out[f'{prefix}{n}'] = data[data_off + doff:data_off + doff + dsize]
    walk(0, f'{nodes[0][0]}/')
    return out
