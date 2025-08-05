#!/bin/bash

# Load configuration
source "$(dirname "$0")/docker.config.sh"

docker system prune -f
docker build -t ${IMAGE_NAME}:${IMAGE_TAG} .
docker stop ${CONTAINER_NAME}
docker rm ${CONTAINER_NAME}
docker tag ${IMAGE_NAME}:${IMAGE_TAG} ${LOCAL_REGISTRY}/${CONTAINER_NAME}:${IMAGE_TAG}
docker compose build
docker compose up -d
docker push ${IMAGE_NAME}:${IMAGE_TAG}

# Recreate container on Portainer (pull latest image + recreate in one call)
echo "Getting container ID for: $CONTAINER_NAME"
CONTAINER_ID=$(curl -s -X GET "$PORTAINER_URL/api/endpoints/$ENDPOINT_ID/docker/containers/json" \
  -H "X-API-Key: $PORTAINER_API_KEY" | \
  jq -r ".[] | select(.Names[] | contains(\"$CONTAINER_NAME\")) | .Id")

if [ -z "$CONTAINER_ID" ] || [ "$CONTAINER_ID" = "null" ]; then
  echo "❌ Container '$CONTAINER_NAME' not found!"
  exit 1
fi

echo "Found container ID: $CONTAINER_ID"
echo "Recreating container on Portainer..."

# Pull latest image
echo "Pulling latest image..."
curl -s -X POST "$PORTAINER_URL/api/endpoints/$ENDPOINT_ID/docker/images/create?fromImage=${IMAGE_NAME}&tag=${IMAGE_TAG}" \
  -H "X-API-Key: $PORTAINER_API_KEY"

# Stop container
echo "Stopping container..."
curl -s -X POST "$PORTAINER_URL/api/endpoints/$ENDPOINT_ID/docker/containers/$CONTAINER_ID/stop" \
  -H "X-API-Key: $PORTAINER_API_KEY"

# Start container (this will use the new image)
echo "Starting container..."
START_RESULT=$(curl -s -X POST "$PORTAINER_URL/api/endpoints/$ENDPOINT_ID/docker/containers/$CONTAINER_ID/start" \
  -H "X-API-Key: $PORTAINER_API_KEY")
echo "Start result: $START_RESULT"

echo "✅ Container recreation complete!"
 

 ## remove all unused images from portainer
echo "Removing unused images from Portainer..."
curl -s -X POST "$PORTAINER_URL/api/endpoints/$ENDPOINT_ID/docker/images/prune" \
  -H "X-API-Key: $PORTAINER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dangling": true}'   

echo "Unused images removed!"