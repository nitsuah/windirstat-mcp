#!/usr/bin/env bash
# windirstat-mcp Docker runner with container reuse and managed lifecycle

set -euo pipefail

IMAGE_NAME="windirstat-mcp"
CONTAINER_NAME="windirstat-mcp-server"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$SCRIPT_DIR}"

# Build image if needed
if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
    echo "Building image..."
    docker build -t "$IMAGE_NAME" "$PROJECT_DIR"
fi

# Check for existing container
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    # Container exists - check if running
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo "Reusing running container: $CONTAINER_NAME"
        exec docker attach "$CONTAINER_NAME"
    else
        echo "Starting stopped container: $CONTAINER_NAME"
        docker start "$CONTAINER_NAME" >/dev/null
        exec docker attach "$CONTAINER_NAME"
    fi
else
    echo "Creating new container: $CONTAINER_NAME"
    exec docker run -i \
        --name "$CONTAINER_NAME" \
        -v "$PROJECT_DIR:/app" \
        -v "C:/:/host-c:ro" \
        "$IMAGE_NAME"
fi
