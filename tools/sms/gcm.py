#!/usr/bin/env python3
"""Read a GameCube disc image (GCM/ISO): list and extract files from its file table."""
import os, struct, sys


class GCM:
    def __init__(self, path):
        self.f = open(path, 'rb')
        self.f.seek(0)
        self.game_id = self.f.read(6).decode('ascii', 'replace')
        self.f.seek(0x424)
        fst_off, fst_size = struct.unpack('>II', self.f.read(8))
        self.f.seek(fst_off)
        fst = self.f.read(fst_size)
        count = struct.unpack('>I', fst[8:12])[0]
        strings = fst[count * 12:]
        self.files = {}  # path -> (offset, size)
        def name(i):
            off = struct.unpack('>I', fst[i * 12:i * 12 + 4])[0] & 0xffffff
            return strings[off:strings.index(b'\0', off)].decode('shift_jis', 'replace')
        # walk: directories give their end index
        stack = [(count, '')]
        i = 1
        while i < count:
            while stack and i >= stack[-1][0]:
                stack.pop()
            word, a, b = struct.unpack('>III', fst[i * 12:i * 12 + 12])
            n = name(i)
            parent = stack[-1][1] if stack else ''
            if word >> 24:
                stack.append((b, f'{parent}{n}/'))
            else:
                self.files[f'{parent}{n}'] = (a, b)
            i += 1

    def read(self, path):
        off, size = self.files[path]
        self.f.seek(off)
        return self.f.read(size)


if __name__ == '__main__':
    g = GCM(sys.argv[1])
    print(g.game_id, len(g.files), 'files')
    pat = sys.argv[2] if len(sys.argv) > 2 else ''
    for p, (o, s) in sorted(g.files.items()):
        if pat in p:
            print(f'{s:>10} {p}')
