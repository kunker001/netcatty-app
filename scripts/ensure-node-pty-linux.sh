#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 <prepare|verify> <x64|arm64>" >&2
  exit 1
}

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

electron_bin() {
  echo "./node_modules/.bin/electron"
}

log_file_info() {
  local file="$1"
  echo "[node-pty] file: ${file}"
  ls -lh "${file}"
  checksum "${file}"
}

log_optional_spawn_helper() {
  local file="$1"

  if [[ -f "${file}" ]]; then
    test -x "${file}"
    log_file_info "${file}"
  else
    echo "[node-pty] spawn-helper not present at ${file} (expected on Linux)"
  fi
}

log_electron_runtime_info() {
  ELECTRON_RUN_AS_NODE=1 "$(electron_bin)" -e '
    console.log(`[node-pty] electron=${process.versions.electron || "unknown"} node=${process.versions.node} modules=${process.versions.modules}`);
  '
}

assert_loadable_native_module() {
  local file="$1"
  echo "[node-pty] loading native module with Electron runtime: ${file}"
  ELECTRON_RUN_AS_NODE=1 "$(electron_bin)" -e '
    const path = require("node:path");
    require(path.resolve(process.argv[1]));
    console.log("[node-pty] native module loaded successfully");
  ' "${file}"
}

resolve_serialport_prebuild() {
  local root="$1"
  local arch="$2"
  local file

  file="$(find "${root}/prebuilds/linux-${arch}" -maxdepth 1 -type f -name '@serialport+bindings-cpp*.glibc.node' -print | sort | head -n 1)"
  if [[ -z "${file}" ]]; then
    echo "[node-pty] serialport glibc prebuild not found for linux-${arch}" >&2
    exit 1
  fi

  echo "${file}"
}

prepare() {
  local arch="$1"
  local root="node_modules/node-pty"
  local release_dir="${root}/build/Release"
  local prebuild_dir="${root}/prebuilds/linux-${arch}"
  local serialport_root="node_modules/@serialport/bindings-cpp"
  local serialport_release_dir="${serialport_root}/build/Release"
  local serialport_prebuild

  echo "[node-pty] rebuilding native modules for Electron on linux-${arch}"
  log_electron_runtime_info
  rm -rf "${release_dir}" "${prebuild_dir}" "${serialport_release_dir}"
  npx electron-rebuild --force --arch "${arch}" -w "node-pty,@serialport/bindings-cpp"

  test -f "${release_dir}/pty.node"
  test -f "${serialport_release_dir}/bindings.node"

  echo "[node-pty] built Linux runtime artifacts:"
  log_file_info "${release_dir}/pty.node"
  log_optional_spawn_helper "${release_dir}/spawn-helper"
  assert_loadable_native_module "${release_dir}/pty.node"
  log_file_info "${serialport_release_dir}/bindings.node"
  assert_loadable_native_module "${serialport_release_dir}/bindings.node"

  mkdir -p "${prebuild_dir}"
  cp "${release_dir}/pty.node" "${prebuild_dir}/pty.node"
  if [[ -f "${release_dir}/spawn-helper" ]]; then
    cp "${release_dir}/spawn-helper" "${prebuild_dir}/spawn-helper"
  fi

  echo "[node-pty] mirrored Linux runtime artifacts into ${prebuild_dir}:"
  log_file_info "${prebuild_dir}/pty.node"
  log_optional_spawn_helper "${prebuild_dir}/spawn-helper"

  serialport_prebuild="$(resolve_serialport_prebuild "${serialport_root}" "${arch}")"
  echo "[node-pty] serialport packaged prebuild candidate:"
  log_file_info "${serialport_prebuild}"
  assert_loadable_native_module "${serialport_prebuild}"
}

verify() {
  local arch="$1"
  local release_dir
  local prebuild_dir
  local serialport_release_file
  local serialport_prebuild_file

  log_electron_runtime_info

  release_dir="$(find release -type d -path "*/resources/app.asar.unpacked/node_modules/node-pty/build/Release" -print -quit)"
  prebuild_dir="$(find release -type d -path "*/resources/app.asar.unpacked/node_modules/node-pty/prebuilds/linux-${arch}" -print -quit)"
  serialport_release_file="$(find release -type f -path "*/resources/app.asar.unpacked/node_modules/@serialport/bindings-cpp/build/Release/bindings.node" -print -quit)"
  serialport_prebuild_file="$(find release -type f -path "*/resources/app.asar.unpacked/node_modules/@serialport/bindings-cpp/prebuilds/linux-${arch}/@serialport+bindings-cpp*.glibc.node" -print | sort | head -n 1)"

  if [[ -z "${release_dir}" ]]; then
    echo "[node-pty] packaged build/Release directory not found under release/" >&2
    exit 1
  fi

  if [[ -z "${prebuild_dir}" ]]; then
    echo "[node-pty] packaged prebuild directory not found for linux-${arch} under release/" >&2
    exit 1
  fi

  if [[ -z "${serialport_release_file}" ]]; then
    echo "[node-pty] packaged serialport build/Release binding not found under release/" >&2
    exit 1
  fi

  if [[ -z "${serialport_prebuild_file}" ]]; then
    echo "[node-pty] packaged serialport glibc prebuild not found for linux-${arch} under release/" >&2
    exit 1
  fi

  test -f "${release_dir}/pty.node"
  test -f "${prebuild_dir}/pty.node"

  echo "[node-pty] packaged build/Release artifacts:"
  log_file_info "${release_dir}/pty.node"
  log_optional_spawn_helper "${release_dir}/spawn-helper"
  assert_loadable_native_module "${release_dir}/pty.node"

  echo "[node-pty] packaged prebuild artifacts:"
  log_file_info "${prebuild_dir}/pty.node"
  log_optional_spawn_helper "${prebuild_dir}/spawn-helper"
  assert_loadable_native_module "${prebuild_dir}/pty.node"

  echo "[node-pty] packaged serialport build/Release artifact:"
  log_file_info "${serialport_release_file}"
  assert_loadable_native_module "${serialport_release_file}"

  echo "[node-pty] packaged serialport prebuild artifact:"
  log_file_info "${serialport_prebuild_file}"
  assert_loadable_native_module "${serialport_prebuild_file}"

  echo "[node-pty] packaged artifact locations:"
  find release -path "*/resources/app.asar.unpacked/node_modules/node-pty/*" \
    \( -name 'pty.node' -o -name 'spawn-helper' \) \
    -print | sort

  find release -path "*/resources/app.asar.unpacked/node_modules/@serialport/bindings-cpp/*" \
    \( -name 'bindings.node' -o -name '@serialport+bindings-cpp*.node' \) \
    -print | sort
}

main() {
  if [[ $# -ne 2 ]]; then
    usage
  fi

  case "$1" in
    prepare)
      prepare "$2"
      ;;
    verify)
      verify "$2"
      ;;
    *)
      usage
      ;;
  esac
}

main "$@"
