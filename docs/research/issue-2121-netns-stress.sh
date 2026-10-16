#!/usr/bin/env bash

set -Eeuo pipefail

# Reproducible, isolated network stress checks for MoshCatty against the
# distribution-provided mosh-server. The script only changes links inside two
# temporary network namespaces; it does not touch the host's default network.

MODE=${1:-quick}
MOSHCATTY_BIN=${MOSHCATTY_BIN:-/root/mosh-client-0.1.7}
RUN_ROOT=${RUN_ROOT:-/root/moshcatty-netns-stress}
LONG_INPUTS=${LONG_INPUTS:-1800}
LONG_LARGE_EVERY=${LONG_LARGE_EVERY:-30}
LONG_PROGRESS_EVERY=${LONG_PROGRESS_EVERY:-300}
NS_CLIENT="mc2121c$$"
NS_SERVER="mc2121s$$"
IF_CLIENT="mc${$}c0"
IF_SERVER="mc${$}s0"
IPV4_CLIENT=10.212.1.1
IPV4_SERVER=10.212.1.2
IPV6_CLIENT=fd21:21::1
IPV6_SERVER=fd21:21::2
PORT=60050
TMUX_SOCKET="mc2121-$$"
CURRENT_SCREEN=
CURRENT_CASE_DIR=
CURRENT_KEY=
PCAP_PID=

require_root() {
  if [[ ${EUID} -ne 0 ]]; then
    echo "This test must run as root." >&2
    exit 2
  fi
}

require_tools() {
  local tool
  for tool in ip tc tmux timeout tcpdump python3 awk grep sed base64 head ps readlink mosh-server; do
    command -v "$tool" >/dev/null || {
      echo "Missing required command: $tool" >&2
      exit 2
    }
  done
  if [[ ! -x ${MOSHCATTY_BIN} ]]; then
    echo "MoshCatty binary is not executable: ${MOSHCATTY_BIN}" >&2
    exit 2
  fi
  if ! python3 - <<'PY' >/dev/null 2>&1
from cryptography.hazmat.primitives.ciphers.aead import AESOCB3
PY
  then
    echo "Missing Python AES-OCB3 support. Install Ubuntu package python3-cryptography." >&2
    exit 2
  fi
}

cleanup_client() {
  if tmux -L "${TMUX_SOCKET}" has-session -t mosh 2>/dev/null; then
    tmux -L "${TMUX_SOCKET}" kill-server 2>/dev/null || true
  fi
}

cleanup() {
  local ns pid
  if [[ -n ${PCAP_PID} ]] && kill -0 "${PCAP_PID}" 2>/dev/null; then
    kill -INT "${PCAP_PID}" 2>/dev/null || true
    wait "${PCAP_PID}" 2>/dev/null || true
    PCAP_PID=
  fi
  cleanup_client
  for ns in "${NS_CLIENT}" "${NS_SERVER}"; do
    if ip netns list | awk '{print $1}' | grep -Fxq "${ns}"; then
      while read -r pid; do
        [[ -n ${pid} ]] && kill "${pid}" 2>/dev/null || true
      done < <(ip netns pids "${ns}" 2>/dev/null || true)
      ip netns delete "${ns}" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

setup_namespaces() {
  mkdir -p "${RUN_ROOT}"
  ip netns add "${NS_CLIENT}"
  ip netns add "${NS_SERVER}"
  ip link add "${IF_CLIENT}" type veth peer name "${IF_SERVER}"
  ip link set "${IF_CLIENT}" netns "${NS_CLIENT}"
  ip link set "${IF_SERVER}" netns "${NS_SERVER}"

  ip -n "${NS_CLIENT}" link set lo up
  ip -n "${NS_SERVER}" link set lo up
  ip -n "${NS_CLIENT}" addr add "${IPV4_CLIENT}/30" dev "${IF_CLIENT}"
  ip -n "${NS_SERVER}" addr add "${IPV4_SERVER}/30" dev "${IF_SERVER}"
  ip -n "${NS_CLIENT}" -6 addr add "${IPV6_CLIENT}/64" dev "${IF_CLIENT}" nodad
  ip -n "${NS_SERVER}" -6 addr add "${IPV6_SERVER}/64" dev "${IF_SERVER}" nodad
  ip -n "${NS_CLIENT}" link set "${IF_CLIENT}" up
  ip -n "${NS_SERVER}" link set "${IF_SERVER}" up

  ip netns exec "${NS_CLIENT}" ping -c 1 -W 2 "${IPV4_SERVER}" >/dev/null
  ip netns exec "${NS_CLIENT}" ping -6 -c 1 -W 2 "${IPV6_SERVER}" >/dev/null
}

set_netem() {
  local ns=$1
  local iface=$2
  shift 2
  ip netns exec "${ns}" tc qdisc replace dev "${iface}" root netem "$@"
}

clear_netem() {
  local ns=$1
  local iface=$2
  ip netns exec "${ns}" tc qdisc delete dev "${iface}" root 2>/dev/null || true
}

set_mtu() {
  local mtu=$1
  ip -n "${NS_CLIENT}" link set "${IF_CLIENT}" mtu "${mtu}"
  ip -n "${NS_SERVER}" link set "${IF_SERVER}" mtu "${mtu}"
}

remove_ipv4_addresses() {
  ip -n "${NS_CLIENT}" -4 addr delete "${IPV4_CLIENT}/30" dev "${IF_CLIENT}"
  ip -n "${NS_SERVER}" -4 addr delete "${IPV4_SERVER}/30" dev "${IF_SERVER}"
}

restore_ipv4_addresses() {
  ip -n "${NS_CLIENT}" -4 addr add "${IPV4_CLIENT}/30" dev "${IF_CLIENT}"
  ip -n "${NS_SERVER}" -4 addr add "${IPV4_SERVER}/30" dev "${IF_SERVER}"
}

start_session() {
  local name=$1
  local host=$2
  local timeout_seconds=${3:-300}
  local width=${4:-100}
  local height=${5:-30}
  local case_dir="${RUN_ROOT}/${name}"
  local server_output key

  cleanup_client
  rm -rf "${case_dir}"
  mkdir -p "${case_dir}"
  CURRENT_CASE_DIR="${case_dir}"
  server_output=$(ip netns exec "${NS_SERVER}" env LANG=C.UTF-8 TERM=xterm-256color \
    mosh-server new -s -i "${host}" -p "${PORT}" -l LANG=C.UTF-8 2>&1)
  key=$(printf '%s\n' "${server_output}" | awk '$1 == "MOSH" && $2 == "CONNECT" { print $4; exit }')
  if [[ -z ${key} ]]; then
    echo "${name}: mosh-server did not return a session key" >&2
    return 1
  fi
  CURRENT_KEY=${key}
  printf '%s\n' "${server_output}" \
    | sed -E 's/^(MOSH CONNECT [0-9]+) [^[:space:]]+$/\1 [REDACTED]/' \
    >"${case_dir}/server.log"

  CURRENT_SCREEN="${case_dir}/client.screen"
  ip netns exec "${NS_CLIENT}" env \
    TERM=xterm-256color \
    LANG=C.UTF-8 \
    MOSH_KEY="${key}" \
    MOSH_NO_TERM_INIT=1 \
    tmux -L "${TMUX_SOCKET}" new-session -d -x "${width}" -y "${height}" -s mosh \
    "exec timeout --signal=TERM ${timeout_seconds}s ${MOSHCATTY_BIN} ${host} ${PORT}"
  tmux -L "${TMUX_SOCKET}" pipe-pane -o -t mosh "cat >>${case_dir}/client.raw"
  sleep 1
}

start_ipv6_capture() {
  local pcap_file=$1
  rm -f "${pcap_file}" "${pcap_file}.log"
  ip netns exec "${NS_CLIENT}" \
    tcpdump -U -i "${IF_CLIENT}" -s 0 -w "${pcap_file}" \
    "ip6 and udp port ${PORT}" >"${pcap_file}.log" 2>&1 &
  PCAP_PID=$!
  sleep 0.5
}

stop_capture() {
  if [[ -n ${PCAP_PID} ]]; then
    kill -INT "${PCAP_PID}" 2>/dev/null || true
    wait "${PCAP_PID}" 2>/dev/null || true
    PCAP_PID=
  fi
}

send_command() {
  tmux -L "${TMUX_SOCKET}" send-keys -t mosh -l -- "$1"
  tmux -L "${TMUX_SOCKET}" send-keys -t mosh Enter
}

wait_for_marker() {
  local marker=$1
  local timeout_seconds=${2:-60}
  local deadline=$((SECONDS + timeout_seconds))
  while (( SECONDS < deadline )); do
    if ! tmux -L "${TMUX_SOCKET}" has-session -t mosh 2>/dev/null; then
      echo "Client exited before marker appeared: ${marker}" >&2
      return 1
    fi
    tmux -L "${TMUX_SOCKET}" capture-pane -p -t mosh >"${CURRENT_SCREEN}"
    if grep -Fq "${marker}" "${CURRENT_SCREEN}"; then
      return 0
    fi
    sleep 0.25
  done
  echo "Timed out waiting for marker: ${marker}" >&2
  return 1
}

finish_session() {
  send_command "exit"
  local deadline=$((SECONDS + 15))
  while tmux -L "${TMUX_SOCKET}" has-session -t mosh 2>/dev/null && (( SECONDS < deadline )); do
    sleep 0.2
  done
  if tmux -L "${TMUX_SOCKET}" has-session -t mosh 2>/dev/null; then
    echo "Client did not exit cleanly" >&2
    return 1
  fi
  PORT=$((PORT + 1))
}

assert_exact_sequence() {
  local file=$1
  local prefix=$2
  local expected=$3
  local i line
  local -a lines
  mapfile -t lines <"${file}"
  if [[ ${#lines[@]} -ne ${expected} ]]; then
    echo "Expected ${expected} executions in ${file}, found ${#lines[@]}" >&2
    return 1
  fi
  for i in $(seq 1 "${expected}"); do
    printf -v line '%s:%03d' "${prefix}" "${i}"
    if [[ ${lines[i - 1]} != "${line}" ]]; then
      echo "Unexpected execution ${i}: ${lines[i - 1]}" >&2
      return 1
    fi
  done
}

verify_ipv6_capture() {
  local pcap_file=$1
  local key=$2
  python3 - "${pcap_file}" 3<<<"${key}" <<'PY'
import base64
import collections
import os
import struct
import sys
import ipaddress

from cryptography.hazmat.primitives.ciphers.aead import AESOCB3

path = sys.argv[1]
with os.fdopen(3) as key_pipe:
    key = base64.b64decode(key_pipe.read().strip() + "==")
cipher = AESOCB3(key)
with open(path, "rb") as handle:
    header = handle.read(24)
    if len(header) != 24:
        raise SystemExit("pcap capture is empty")
    magic = header[:4]
    if magic in (b"\xd4\xc3\xb2\xa1", b"\x4d\x3c\xb2\xa1"):
        endian = "<"
    elif magic in (b"\xa1\xb2\xc3\xd4", b"\xa1\xb2\x3c\x4d"):
        endian = ">"
    else:
        raise SystemExit("unsupported pcap format")

    packets = 0
    max_ipv6_length = 0
    fragment_headers = 0
    server_packets = 0
    server_udp_payload = 0
    server_address = ipaddress.IPv6Address("fd21:21::2").packed
    fragment_groups = collections.defaultdict(set)
    while True:
        record = handle.read(16)
        if not record:
            break
        if len(record) != 16:
            raise SystemExit("truncated pcap record")
        _, _, captured, original = struct.unpack(endian + "IIII", record)
        frame = handle.read(captured)
        if len(frame) != captured:
            raise SystemExit("truncated pcap packet")
        if len(frame) < 54 or frame[12:14] != b"\x86\xdd":
            continue
        packets += 1
        ipv6_length = original - 14
        max_ipv6_length = max(max_ipv6_length, ipv6_length)
        if frame[20] == 44:
            fragment_headers += 1
        if frame[20] == 17 and frame[22:38] == server_address and len(frame) >= 62:
            udp_length = struct.unpack("!H", frame[58:60])[0]
            server_packets += 1
            server_udp_payload += max(0, udp_length - 8)
            datagram = frame[62 : 62 + udp_length - 8]
            if len(datagram) >= 24:
                nonce = b"\x00" * 4 + datagram[:8]
                try:
                    plaintext = cipher.decrypt(nonce, datagram[8:], b"")
                except Exception:
                    continue
                if len(plaintext) >= 14:
                    instruction_id = int.from_bytes(plaintext[4:12], "big")
                    fragment_num = int.from_bytes(plaintext[12:14], "big") & 0x7FFF
                    fragment_groups[instruction_id].add(fragment_num)

if server_packets < 2 or server_udp_payload <= 1280:
    raise SystemExit(
        "capture did not prove application-level splitting: "
        f"server_packets={server_packets}, server_udp_payload={server_udp_payload}"
    )
if max_ipv6_length > 1280:
    raise SystemExit(f"IPv6 packet exceeded MTU 1280: {max_ipv6_length}")
if fragment_headers:
    raise SystemExit(f"IPv6 Fragment Headers observed: {fragment_headers}")
largest_fragment_group = max((len(group) for group in fragment_groups.values()), default=0)
if largest_fragment_group < 2:
    raise SystemExit("capture did not contain a multi-fragment Mosh instruction")
print(
    "pcap verified: "
    f"packets={packets}, server_packets={server_packets}, "
    f"server_udp_payload={server_udp_payload}, "
    f"max_ipv6_packet={max_ipv6_length}, fragment_headers=0, "
    f"largest_mosh_fragment_group={largest_fragment_group}"
)
PY
}

client_rss_kib() {
  local pid exe
  while read -r pid; do
    [[ -n ${pid} ]] || continue
    exe=$(readlink -f "/proc/${pid}/exe" 2>/dev/null || true)
    if [[ ${exe} == "${MOSHCATTY_BIN}" ]]; then
      ps -o rss= -p "${pid}" | awk '{print $1}'
      return 0
    fi
  done < <(ip netns pids "${NS_CLIENT}")
  echo "Could not find the running MoshCatty client" >&2
  return 1
}

test_upstream_loss_baseline() {
  echo "[quick 1/4] upstream-published 100 ms RTT and 29% loss in each direction"
  set_mtu 1500
  set_netem "${NS_CLIENT}" "${IF_CLIENT}" delay 50ms loss 29%
  set_netem "${NS_SERVER}" "${IF_SERVER}" delay 50ms loss 29%
  start_session upstream_loss "${IPV4_SERVER}" 240
  local execution_log="${CURRENT_CASE_DIR}/executions.log"
  local i marker
  for i in $(seq 1 10); do
    printf -v marker 'LOSS_OK:%03d' "${i}"
    send_command "printf 'LOSS_OK:%03d\\n' ${i} >>${execution_log}; printf '%s:%03d\\n' LOSS_OK ${i}"
    wait_for_marker "${marker}" 90
  done
  assert_exact_sequence "${execution_log}" LOSS_OK 10
  finish_session
  echo "PASS upstream loss baseline (10/10 exactly once)"
}

test_asymmetric_impairment() {
  echo "[quick 2/4] asymmetric latency, loss, duplication, and reordering"
  set_mtu 1500
  set_netem "${NS_CLIENT}" "${IF_CLIENT}" delay 300ms 60ms distribution normal loss 5% duplicate 2% reorder 10% 50%
  set_netem "${NS_SERVER}" "${IF_SERVER}" delay 450ms 80ms distribution normal loss 12% duplicate 3% reorder 15% 50%
  start_session asymmetric "${IPV4_SERVER}" 180
  local execution_log="${CURRENT_CASE_DIR}/executions.log"
  local i marker
  for i in $(seq 1 10); do
    printf -v marker 'NET_OK:%03d' "${i}"
    send_command "printf 'NET_OK:%03d\\n' ${i} >>${execution_log}; printf '%s:%03d\\n' NET_OK ${i}"
    wait_for_marker "${marker}" 60
  done
  assert_exact_sequence "${execution_log}" NET_OK 10
  finish_session
  echo "PASS asymmetric impairment (10/10 exactly once)"
}

test_long_outage() {
  echo "[quick 3/4] queued input across a 65-second total outage"
  set_mtu 1500
  set_netem "${NS_CLIENT}" "${IF_CLIENT}" delay 80ms 10ms loss 1%
  set_netem "${NS_SERVER}" "${IF_SERVER}" delay 120ms 15ms loss 2%
  start_session outage65 "${IPV4_SERVER}" 210
  send_command "printf '%s%s\\n' BEFORE_ OUTAGE"
  wait_for_marker BEFORE_OUTAGE 30

  set_netem "${NS_CLIENT}" "${IF_CLIENT}" loss 100%
  set_netem "${NS_SERVER}" "${IF_SERVER}" loss 100%
  local execution_log="${CURRENT_CASE_DIR}/executions.log"
  send_command "printf '%s\\n' OUTAGE_QUEUED >>${execution_log}; printf '%s%s\\n' QUEUED_ INPUT_OK"
  sleep 65

  set_netem "${NS_CLIENT}" "${IF_CLIENT}" delay 80ms 10ms loss 1%
  set_netem "${NS_SERVER}" "${IF_SERVER}" delay 120ms 15ms loss 2%
  wait_for_marker QUEUED_INPUT_OK 10
  if [[ $(grep -Fxc OUTAGE_QUEUED "${execution_log}") -ne 1 ]]; then
    echo "Input queued during the outage was not executed exactly once" >&2
    return 1
  fi
  send_command "printf '%s%s\\n' AFTER_ OUTAGE"
  wait_for_marker AFTER_OUTAGE 10
  finish_session
  echo "PASS 65-second outage recovery with queued input preserved exactly once"
}

test_ipv6_minimum_mtu() {
  echo "[quick 4/4] IPv6 minimum MTU, large incompressible screen, and packet capture"
  clear_netem "${NS_CLIENT}" "${IF_CLIENT}"
  clear_netem "${NS_SERVER}" "${IF_SERVER}"
  set_mtu 1280
  remove_ipv4_addresses
  set_netem "${NS_CLIENT}" "${IF_CLIENT}" delay 120ms 20ms loss 2% duplicate 1%
  set_netem "${NS_SERVER}" "${IF_SERVER}" delay 180ms 30ms loss 4% reorder 5% 50%
  local pcap_file="${RUN_ROOT}/ipv6-mtu1280.pcap"
  start_ipv6_capture "${pcap_file}"
  start_session ipv6_mtu1280 "${IPV6_SERVER}" 240 200 100
  send_command "head -c 12000 /dev/urandom | base64; printf '%s%s\\n' IPV6_ MTU_OK"
  wait_for_marker IPV6_MTU_OK 90
  sleep 3
  finish_session
  sleep 1
  stop_capture
  verify_ipv6_capture "${pcap_file}" "${CURRENT_KEY}"
  CURRENT_KEY=
  restore_ipv4_addresses
  echo "PASS IPv6 MTU 1280 with application-level splitting and no network fragmentation"
}

test_long_asymmetric_pressure() {
  echo "[long] ${LONG_INPUTS}-second asymmetric network pressure with one input per second"
  set_mtu 1500
  set_netem "${NS_CLIENT}" "${IF_CLIENT}" delay 250ms 60ms distribution normal loss 1% duplicate 1% reorder 5% 50%
  set_netem "${NS_SERVER}" "${IF_SERVER}" delay 450ms 100ms distribution normal loss 3% duplicate 2% reorder 10% 50%
  start_session long30m "${IPV4_SERVER}" 2700

  local execution_log="${CURRENT_CASE_DIR}/executions.log"
  local i marker payload target delay rss baseline_rss final_rss allowed_growth allowed_final
  local monotonic_growth=1
  local started=${SECONDS}
  local -a rss_samples=()
  for i in $(seq 1 "${LONG_INPUTS}"); do
    payload=
    if (( i % LONG_LARGE_EVERY == 0 )); then
      payload="head -c 12000 /dev/urandom | base64; "
    fi
    send_command "${payload}printf 'LONG_OK:%03d\\n' ${i} >>${execution_log}; printf '%s:%03d\\n' LONG_OK ${i}"

    if (( i % LONG_PROGRESS_EVERY == 0 || i == LONG_INPUTS )); then
      rss=$(client_rss_kib)
      rss_samples+=("${rss}")
      if [[ -z ${baseline_rss:-} ]]; then
        baseline_rss=${rss}
      fi
      echo "  progress: ${i}/${LONG_INPUTS} inputs queued, client RSS ${rss} KiB"
    fi

    target=$((started + i))
    delay=$((target - SECONDS))
    if (( delay > 0 )); then
      sleep "${delay}"
    fi
  done

  printf -v marker 'LONG_OK:%03d' "${LONG_INPUTS}"
  wait_for_marker "${marker}" 300
  assert_exact_sequence "${execution_log}" LONG_OK "${LONG_INPUTS}"

  final_rss=$(client_rss_kib)
  allowed_growth=$((baseline_rss / 4))
  if (( allowed_growth < 32768 )); then
    allowed_growth=32768
  fi
  allowed_final=$((baseline_rss + allowed_growth))
  if (( final_rss > allowed_final )); then
    echo "Client RSS grew beyond the allowed bound: baseline=${baseline_rss}, final=${final_rss}, allowed=${allowed_final} KiB" >&2
    return 1
  fi
  if (( ${#rss_samples[@]} >= 4 )); then
    for ((i = 1; i < ${#rss_samples[@]}; i++)); do
      if (( rss_samples[i] <= rss_samples[i - 1] )); then
        monotonic_growth=0
        break
      fi
    done
    if (( monotonic_growth == 1 && rss_samples[${#rss_samples[@]} - 1] - rss_samples[0] > 8192 )); then
      echo "Client RSS grew monotonically by more than 8 MiB: ${rss_samples[*]} KiB" >&2
      return 1
    fi
  fi

  clear_netem "${NS_CLIENT}" "${IF_CLIENT}"
  clear_netem "${NS_SERVER}" "${IF_SERVER}"
  send_command "printf '%s%s\\n' POST_ PRESSURE_OK"
  wait_for_marker POST_PRESSURE_OK 10
  finish_session
  echo "  RSS samples (KiB): ${rss_samples[*]}"
  echo "PASS ${LONG_INPUTS}-second asymmetric pressure (${LONG_INPUTS}/${LONG_INPUTS} exactly once, recovery under 10 seconds)"
}

main() {
  require_root
  require_tools
  setup_namespaces

  case "${MODE}" in
    quick)
      test_upstream_loss_baseline
      test_asymmetric_impairment
      test_long_outage
      test_ipv6_minimum_mtu
      ;;
    long)
      test_long_asymmetric_pressure
      ;;
    ipv6)
      test_ipv6_minimum_mtu
      ;;
    outage)
      test_long_outage
      ;;
    all)
      test_upstream_loss_baseline
      test_asymmetric_impairment
      test_long_outage
      test_ipv6_minimum_mtu
      test_long_asymmetric_pressure
      ;;
    *)
      echo "Usage: $0 [quick|long|ipv6|outage|all]" >&2
      exit 2
      ;;
  esac

  echo "All requested network namespace stress checks passed."
  echo "Logs: ${RUN_ROOT}"
}

main "$@"
