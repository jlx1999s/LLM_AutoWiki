#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
WEB_DIR="${ROOT_DIR}/apps/web"

RUNTIME_DIR="${ROOT_DIR}/.dev-runtime"
LOG_DIR="${RUNTIME_DIR}/logs"
PID_DIR="${RUNTIME_DIR}/pids"

BACKEND_PID_FILE="${PID_DIR}/backend.pid"
WEB_PID_FILE="${PID_DIR}/web.pid"
BACKEND_LOG_FILE="${LOG_DIR}/backend.log"
WEB_LOG_FILE="${LOG_DIR}/web.log"

BACKEND_PORT="${BACKEND_PORT:-8000}"
WEB_PORT="${WEB_PORT:-5173}"

mkdir -p "${LOG_DIR}" "${PID_DIR}"

print_step() {
  printf "\n==> %s\n" "$1"
}

is_running_pid() {
  local pid="$1"
  kill -0 "${pid}" >/dev/null 2>&1
}

kill_pid_file() {
  local pid_file="$1"
  local name="$2"
  if [[ ! -f "${pid_file}" ]]; then
    return 0
  fi

  local pid
  pid="$(cat "${pid_file}" 2>/dev/null || true)"
  if [[ -n "${pid}" ]] && is_running_pid "${pid}"; then
    printf "Stopping %s (pid=%s)\n" "${name}" "${pid}"
    kill "${pid}" >/dev/null 2>&1 || true
    sleep 1
    if is_running_pid "${pid}"; then
      kill -9 "${pid}" >/dev/null 2>&1 || true
    fi
  fi
  rm -f "${pid_file}"
}

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti tcp:"${port}" 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    printf "Killing process on port %s: %s\n" "${port}" "${pids//$'\n'/ }"
    while IFS= read -r pid; do
      [[ -z "${pid}" ]] && continue
      kill "${pid}" >/dev/null 2>&1 || true
    done <<< "${pids}"
    sleep 1
    pids="$(lsof -ti tcp:"${port}" 2>/dev/null || true)"
    if [[ -n "${pids}" ]]; then
      while IFS= read -r pid; do
        [[ -z "${pid}" ]] && continue
        kill -9 "${pid}" >/dev/null 2>&1 || true
      done <<< "${pids}"
    fi
  fi
}

wait_for_port() {
  local port="$1"
  local name="$2"
  local timeout="${3:-20}"
  local i
  for ((i = 1; i <= timeout; i++)); do
    if lsof -i tcp:"${port}" >/dev/null 2>&1; then
      printf "%s is listening on :%s\n" "${name}" "${port}"
      return 0
    fi
    sleep 1
  done
  printf "WARN: %s did not start within %ss (port %s)\n" "${name}" "${timeout}" "${port}"
  return 1
}

start_backend() {
  print_step "Starting backend"
  local uvicorn_bin
  if [[ -x "${BACKEND_DIR}/.venv/bin/uvicorn" ]]; then
    uvicorn_bin="${BACKEND_DIR}/.venv/bin/uvicorn"
  elif command -v uvicorn >/dev/null 2>&1; then
    uvicorn_bin="$(command -v uvicorn)"
  else
    echo "ERROR: uvicorn not found. Create backend venv and install deps first."
    exit 1
  fi

  (
    cd "${BACKEND_DIR}"
    nohup "${uvicorn_bin}" app.main:app --reload --host 127.0.0.1 --port "${BACKEND_PORT}" \
      > "${BACKEND_LOG_FILE}" 2>&1 &
    echo $! > "${BACKEND_PID_FILE}"
  )
  printf "Backend PID: %s\n" "$(cat "${BACKEND_PID_FILE}")"
}

start_web() {
  print_step "Starting web"
  if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: npm not found."
    exit 1
  fi

  (
    cd "${WEB_DIR}"
    nohup npm run dev -- --host 127.0.0.1 --port "${WEB_PORT}" \
      > "${WEB_LOG_FILE}" 2>&1 &
    echo $! > "${WEB_PID_FILE}"
  )
  printf "Web PID: %s\n" "$(cat "${WEB_PID_FILE}")"
}

stop_all() {
  print_step "Stopping existing services"
  kill_pid_file "${BACKEND_PID_FILE}" "backend"
  kill_pid_file "${WEB_PID_FILE}" "web"
  kill_port "${BACKEND_PORT}"
  kill_port "${WEB_PORT}"
}

status_all() {
  print_step "Service status"
  if [[ -f "${BACKEND_PID_FILE}" ]] && is_running_pid "$(cat "${BACKEND_PID_FILE}")"; then
    echo "backend: running (pid=$(cat "${BACKEND_PID_FILE}"), port=${BACKEND_PORT})"
  else
    echo "backend: stopped"
  fi

  if [[ -f "${WEB_PID_FILE}" ]] && is_running_pid "$(cat "${WEB_PID_FILE}")"; then
    echo "web: running (pid=$(cat "${WEB_PID_FILE}"), port=${WEB_PORT})"
  else
    echo "web: stopped"
  fi

  echo "backend log: ${BACKEND_LOG_FILE}"
  echo "web log: ${WEB_LOG_FILE}"
}

start_all() {
  start_backend
  start_web
  wait_for_port "${BACKEND_PORT}" "backend" 20 || true
  wait_for_port "${WEB_PORT}" "web" 20 || true
  print_step "Done"
  echo "Backend: http://127.0.0.1:${BACKEND_PORT}"
  echo "Web:     http://127.0.0.1:${WEB_PORT}"
  echo "Tail logs:"
  echo "  tail -f ${BACKEND_LOG_FILE}"
  echo "  tail -f ${WEB_LOG_FILE}"
}

cmd="${1:-restart}"

case "${cmd}" in
  restart)
    stop_all
    start_all
    ;;
  start)
    start_all
    ;;
  stop)
    stop_all
    ;;
  status)
    status_all
    ;;
  *)
    echo "Usage: $0 [restart|start|stop|status]"
    exit 1
    ;;
esac

