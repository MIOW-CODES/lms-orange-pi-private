#!/bin/sh
set -eu

security_options="$(docker info --format '{{json .SecurityOptions}}')"
case "$security_options" in
  *rootless*) ;;
  *)
    echo "Refusing PostgreSQL test cleanup: the selected Docker daemon is not rootless." >&2
    exit 1
    ;;
esac

containers="$(docker ps --all --quiet --filter label=com.docker.compose.project)"
printf '%s\n' "$containers" | while IFS= read -r container_id; do
  [ -n "$container_id" ] || continue
  project_name="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container_id" 2>/dev/null)" || continue
  case "$project_name" in
    miow-pgtest-*) docker rm --force "$container_id" >/dev/null ;;
  esac
done

networks="$(docker network ls --format '{{.Name}}')"
printf '%s\n' "$networks" | while IFS= read -r network_name; do
  case "$network_name" in
    miow-pgtest-*) docker network rm "$network_name" >/dev/null ;;
  esac
done

volumes="$(docker volume ls --format '{{.Name}}')"
printf '%s\n' "$volumes" | while IFS= read -r volume_name; do
  case "$volume_name" in
    miow-pgtest-*) docker volume rm "$volume_name" >/dev/null ;;
  esac
done
