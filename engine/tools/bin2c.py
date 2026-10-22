#!/usr/bin/env python3
# A binary file as C array items, byte by byte: 0x1F,0x0,0xA, ... and a newline at the end.
# (What `hexdump -v -e '1/1 "0x%X,"'` + `echo` printed; hexdump is not on every system.)
#   python3 tools/bin2c.py FILE > out.inc.c      (FILE "-" reads stdin)
import sys

data = sys.stdin.buffer.read() if sys.argv[1] == "-" else open(sys.argv[1], "rb").read()
sys.stdout.write("".join("0x%X," % b for b in data) + "\n")
