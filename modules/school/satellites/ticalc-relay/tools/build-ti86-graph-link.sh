#!/usr/bin/env bash
set -euo pipefail

# Build the maintained tilibs stack and the repository's TI-86 Graph Link
# utility into this extension. Generated sources/libraries stay in .toolchain;
# the executable is written to bin/ti86-graph-link. Both are gitignored.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
relay_dir="$(cd "$script_dir/.." && pwd)"
repo_dir="$(cd "$relay_dir/../.." && pwd)"
work_dir="$relay_dir/.toolchain"
source_cache="$work_dir/sources"
source_dir="$work_dir/src"
prefix_dir="$work_dir/prefix"
binary_dir="$relay_dir/bin"
patch_file="$script_dir/patches/libticalcs-no-empty-final-chunk.patch"
native_source="$repo_dir/_extensions/ti86-app/tools/native/ti86-graph-link.c"

mkdir -p "$source_cache" "$source_dir" "$prefix_dir" "$binary_dir"

packages=(
  "libticonv|1.1.6~git20240415.7c4858d|https://deb.debian.org/debian/pool/main/libt/libticonv/libticonv_1.1.6~git20240415.7c4858d.orig.tar.bz2"
  "libtifiles|1.1.8~git20240415.7c4858d|https://deb.debian.org/debian/pool/main/libt/libtifiles/libtifiles_1.1.8~git20240415.7c4858d.orig.tar.bz2"
  "libticables|1.3.6~git20240415.7c4858d+dfsg|https://deb.debian.org/debian/pool/main/libt/libticables/libticables_1.3.6~git20240415.7c4858d+dfsg.orig.tar.bz2"
  "libticalcs|1.1.10~git20240415.7c4858d+dfsg|https://deb.debian.org/debian/pool/main/libt/libticalcs/libticalcs_1.1.10~git20240415.7c4858d+dfsg.orig.tar.bz2"
)

for package in "${packages[@]}"; do
  IFS='|' read -r name version url <<< "$package"
  archive="$source_cache/$name.tar.bz2"
  extracted="$source_dir/$name-$version"
  if [[ ! -f "$archive" ]]; then
    curl --fail --location --silent --show-error "$url" --output "$archive"
  fi
  if [[ ! -d "$extracted" ]]; then
    tar -xjf "$archive" -C "$source_dir"
  fi
done

ticalcs_source="$source_dir/libticalcs-1.1.10~git20240415.7c4858d+dfsg"
if ! rg -q 'if \(!ret && r\)' "$ticalcs_source/src/dbus_pkt.cc"; then
  patch -d "$ticalcs_source" -p1 < "$patch_file"
fi

export PKG_CONFIG_PATH="$prefix_dir/lib/pkgconfig:/opt/homebrew/opt/libarchive/lib/pkgconfig:/opt/homebrew/opt/libusb/lib/pkgconfig:/opt/homebrew/lib/pkgconfig:/opt/homebrew/share/pkgconfig"
jobs="$(sysctl -n hw.ncpu 2>/dev/null || getconf _NPROCESSORS_ONLN || echo 2)"

build_library() {
  local directory="$1"
  shift
  (
    cd "$directory"
    make distclean >/dev/null 2>&1 || true
    lt_cv_sys_max_cmd_len=262144 ./configure --prefix="$prefix_dir" --disable-static --enable-shared "$@"
    make -j "$jobs"
    make install
  )
}

build_library "$source_dir/libticonv-1.1.6~git20240415.7c4858d" --disable-nls
build_library "$source_dir/libtifiles-1.1.8~git20240415.7c4858d"
build_library "$source_dir/libticables-1.3.6~git20240415.7c4858d+dfsg" --enable-libusb --enable-libusb10
build_library "$ticalcs_source"

cc "$native_source" -o "$binary_dir/ti86-graph-link" \
  $(PKG_CONFIG_PATH="$PKG_CONFIG_PATH" pkg-config --cflags --libs ticalcs2 ticables2 tifiles2 ticonv)

echo "Built $binary_dir/ti86-graph-link"
