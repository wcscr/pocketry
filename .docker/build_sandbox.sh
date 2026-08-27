#!/bin/sh
set -e

docker build -f .docker/Dockerfile \
    --build-arg HOST_UID="$(id -u)" \
    --build-arg HOST_GID="$(id -g)" \
    -t tooltrace-dev-claude .
