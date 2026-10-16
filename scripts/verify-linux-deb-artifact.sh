#!/usr/bin/env bash

set -euo pipefail

TEMP_DIR=""

usage() {
  echo "Usage: $0 <amd64|arm64> [deb-file]" >&2
  exit 1
}

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

require_cmd() {
  local cmd="$1"
  command -v "${cmd}" >/dev/null 2>&1 || {
    echo "[deb-verify] missing required command: ${cmd}" >&2
    exit 1
  }
}

assert_exists() {
  local file="$1"
  if [[ ! -e "${file}" ]]; then
    echo "[deb-verify] expected file does not exist: ${file}" >&2
    exit 1
  fi
}

assert_executable() {
  local file="$1"
  if [[ ! -x "${file}" ]]; then
    echo "[deb-verify] expected executable file is missing or not executable: ${file}" >&2
    exit 1
  fi
}

log_file_info() {
  local file="$1"
  echo "[deb-verify] file: ${file}"
  ls -lh "${file}"
  file "${file}"
  checksum "${file}"
}

assert_file_arch() {
  local file="$1"
  local expected="$2"
  local info

  info="$(file "${file}")"
  echo "[deb-verify] arch-check: ${info}"
  if [[ "${info}" != *"${expected}"* ]]; then
    echo "[deb-verify] unexpected architecture for ${file}" >&2
    echo "[deb-verify] expected substring: ${expected}" >&2
    exit 1
  fi
}

assert_loadable_native_module() {
  local electron_bin="$1"
  local native_module="$2"

  if [[ "${VERIFY_LOAD:-1}" != "1" ]]; then
    echo "[deb-verify] skipping native module load check for ${native_module} (VERIFY_LOAD=${VERIFY_LOAD:-1})"
    return
  fi

  echo "[deb-verify] loading native module with packaged Electron runtime: ${native_module}"
  ELECTRON_RUN_AS_NODE=1 "${electron_bin}" -e '
    const path = require("node:path");
    require(path.resolve(process.argv[1]));
    console.log("[deb-verify] native module loaded successfully");
  ' "${native_module}"
}

resolve_file_from_glob() {
  local search_dir="$1"
  local pattern="$2"
  find "${search_dir}" -maxdepth 1 -type f -name "${pattern}" -print | sort | head -n 1
}

resolve_single_file() {
  local search_dir="$1"
  local pattern="$2"
  local file

  file="$(resolve_file_from_glob "${search_dir}" "${pattern}")"
  if [[ -z "${file}" ]]; then
    echo "[deb-verify] no file matched ${pattern} under ${search_dir}" >&2
    exit 1
  fi

  echo "${file}"
}

resolve_serialport_prebuild() {
  local root="$1"
  local arch="$2"
  local prebuild_dir="${root}/prebuilds/linux-${arch}"
  local file

  file="$(find "${prebuild_dir}" -maxdepth 1 -type f -name '@serialport+bindings-cpp*.glibc.node' -print | sort | head -n 1)"
  if [[ -z "${file}" ]]; then
    echo "[deb-verify] serialport glibc prebuild not found under ${prebuild_dir}" >&2
    exit 1
  fi

  echo "${file}"
}

verify_native_module() {
  local label="$1"
  local electron_bin="$2"
  local file="$3"
  local expected_machine="$4"

  assert_exists "${file}"
  echo "[deb-verify] verifying ${label}"
  log_file_info "${file}"
  assert_file_arch "${file}" "${expected_machine}"
  assert_loadable_native_module "${electron_bin}" "${file}"
}

main() {
  if [[ $# -lt 1 || $# -gt 2 ]]; then
    usage
  fi

  local deb_arch="$1"
  local prebuild_arch
  local expected_machine
  local deb_file
  local control_arch
  local electron_bin
  local main_binary
  local build_release_pty
  local prebuild_pty
  local serialport_root
  local build_release_serialport
  local prebuild_serialport

  require_cmd dpkg-deb
  require_cmd file

  case "${deb_arch}" in
    amd64)
      prebuild_arch="x64"
      expected_machine="x86-64"
      ;;
    arm64)
      prebuild_arch="arm64"
      expected_machine="ARM aarch64"
      ;;
    *)
      usage
      ;;
  esac

  if [[ $# -eq 2 ]]; then
    deb_file="$2"
    assert_exists "${deb_file}"
  else
    deb_file="$(resolve_single_file "release" "*-linux-${deb_arch}.deb")"
  fi

  echo "[deb-verify] verifying deb artifact: ${deb_file}"
  log_file_info "${deb_file}"

  control_arch="$(dpkg-deb -f "${deb_file}" Architecture)"
  echo "[deb-verify] control architecture: ${control_arch}"
  if [[ "${control_arch}" != "${deb_arch}" ]]; then
    echo "[deb-verify] deb control architecture mismatch: expected ${deb_arch}, got ${control_arch}" >&2
    exit 1
  fi

  TEMP_DIR="$(mktemp -d)"
  trap 'rm -rf "${TEMP_DIR:-}"' EXIT
  dpkg-deb -x "${deb_file}" "${TEMP_DIR}"

  electron_bin="${TEMP_DIR}/opt/Netcatty/netcatty"
  main_binary="${TEMP_DIR}/opt/Netcatty/netcatty"
  build_release_pty="${TEMP_DIR}/opt/Netcatty/resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node"
  prebuild_pty="${TEMP_DIR}/opt/Netcatty/resources/app.asar.unpacked/node_modules/node-pty/prebuilds/linux-${prebuild_arch}/pty.node"
  serialport_root="${TEMP_DIR}/opt/Netcatty/resources/app.asar.unpacked/node_modules/@serialport/bindings-cpp"
  build_release_serialport="${serialport_root}/build/Release/bindings.node"
  prebuild_serialport="$(resolve_serialport_prebuild "${serialport_root}" "${prebuild_arch}")"

  assert_executable "${electron_bin}"

  echo "[deb-verify] verifying packaged binary architectures"
  log_file_info "${main_binary}"
  assert_file_arch "${main_binary}" "${expected_machine}"
  verify_native_module "node-pty build/Release" "${electron_bin}" "${build_release_pty}" "${expected_machine}"
  verify_native_module "node-pty prebuild" "${electron_bin}" "${prebuild_pty}" "${expected_machine}"
  verify_native_module "serialport build/Release" "${electron_bin}" "${build_release_serialport}" "${expected_machine}"
  verify_native_module "serialport glibc prebuild" "${electron_bin}" "${prebuild_serialport}" "${expected_machine}"

  echo "[deb-verify] deb artifact verification passed for ${deb_file}"
}

main "$@"
