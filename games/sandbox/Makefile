# Sandbox: an N64 game (libdragon + Tiny3D). `make` builds sandbox.z64.
#
#   make                 the ROM (makes the assets first: node tools/build_assets.mjs)
#   make TEST=drive      a ROM that plays itself through a test script (src/testplay.c) and prints
#                        TEST/PASS/FAIL lines; run it with tools/emu.mjs
#   make clean
#
# Needs: N64_INST (libdragon's toolchain and library, preview branch), T3D_INST (tiny3d), Node.js 18+.
BUILD_DIR = build
ifneq ($(TEST),)
TESTFLAGS = -DTESTPLAY=\"$(TEST)\"
NAME = sandbox_test_$(TEST)
BUILD_DIR = build/test_$(TEST)
else
NAME = sandbox
endif
ROM = $(NAME).z64
N64_INST ?= $(HOME)/n64/inst
T3D_INST ?= $(HOME)/n64/tiny3d
include $(N64_INST)/include/n64.mk
include $(T3D_INST)/t3d.mk

N64_CFLAGS += $(TESTFLAGS) -std=gnu2x -O2 -Isrc -Wno-error=unused-variable -Wno-error=unused-function -Wno-error=unused-but-set-variable

SRC = $(wildcard src/*.c)
GLB = $(wildcard assets/*.glb assets/city/*.glb)
PNG = $(wildcard assets/*.png)
FS_MODELS = $(patsubst assets/%.glb,filesystem/%.t3dm,$(GLB))
FS_SPRITES = $(patsubst assets/%.png,filesystem/%.sprite,$(PNG))
MUS = $(wildcard assets/audio/mus_*.wav)
FS_MUSIC = $(patsubst assets/audio/%.wav,filesystem/%.wav64,$(MUS))
FS_DATA = filesystem/voices.bin filesystem/world.bin filesystem/font1.font64 filesystem/font2.font64 filesystem/font3.font64

all: assets/.stamp
	@$(MAKE) --no-print-directory $(ROM)

assets/.stamp: $(wildcard tools/*.mjs tools/lib/*.mjs)
	node tools/build_assets.mjs
	@touch $@

filesystem/%.t3dm: assets/%.glb
	@mkdir -p $(dir $@)
	@echo "    [T3D] $@"
	@$(T3D_GLTF_TO_3D) "$<" $@ --asset-path=assets > /dev/null
	@$(N64_BINDIR)/mkasset -c 1 -o $(dir $@) $@

filesystem/map.sprite: assets/map.png
	@mkdir -p $(dir $@)
	@$(N64_MKSPRITE) -f RGBA16 -c 1 -o filesystem "$<"

filesystem/%.sprite: assets/%.png
	@mkdir -p $(dir $@)
	@$(N64_MKSPRITE) -f RGBA16 -c 1 -o $(dir $@) "$<"

filesystem/%.font64: assets/fonts/%.fnt
	@mkdir -p filesystem
	@$(N64_MKFONT) --format RGBA16 -o filesystem "$<" > /dev/null

filesystem/world.bin: assets/world.bin
	@mkdir -p filesystem
	@cp $< $@
	@$(N64_BINDIR)/mkasset -c 2 -o filesystem $@

# music: VADPCM streams (the jingle plays once, the rest loop)
filesystem/%.wav64: assets/audio/%.wav
	@mkdir -p filesystem
	@echo "    [AUDIO] $@"
	@$(N64_AUDIOCONV) --wav-compress 1 --wav-loop $(if $(findstring passed,$*),false,true) -o filesystem "$<" > /dev/null

filesystem/voices.bin: assets/voices.bin
	@mkdir -p filesystem
	@cp $< $@

$(BUILD_DIR)/$(NAME).dfs: $(FS_MODELS) $(FS_SPRITES) $(FS_DATA) $(FS_MUSIC)
$(BUILD_DIR)/$(NAME).elf: $(SRC:%.c=$(BUILD_DIR)/%.o)

$(ROM): N64_ROM_TITLE = "SANDBOX"
$(ROM): N64_ROM_SAVETYPE = eeprom16k
$(ROM): N64_ROM_EXPANSIONPAK = required
$(ROM): $(BUILD_DIR)/$(NAME).dfs

clean:
	rm -rf build filesystem *.z64 assets/.stamp

-include $(shell find build -name '*.d' 2>/dev/null)
.PHONY: all clean
