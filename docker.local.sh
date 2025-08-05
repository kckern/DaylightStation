#!/bin/bash

# Load configuration
source "$(dirname "$0")/docker.config.sh"

docker system prune -f

docker build -t ${IMAGE_NAME}:${IMAGE_TAG} .
docker stop ${CONTAINER_NAME}
docker rm ${CONTAINER_NAME}


#push to local registry
docker tag ${IMAGE_NAME}:${IMAGE_TAG} ${LOCAL_REGISTRY}/${CONTAINER_NAME}:${IMAGE_TAG}




# build from docker-compose.yml
docker compose build
docker compose up -d




##push to hub
docker push ${IMAGE_NAME}:${IMAGE_TAG}

# Recreate container on Portainer (pull latest image + recreate in one call)
echo "Recreating container on Portainer..."
curl -s -X POST "$PORTAINER_URL/api/endpoints/$ENDPOINT_ID/docker/containers/$CONTAINER_NAME/recreate?pullImage=true" \
  -H "X-API-Key: $PORTAINER_API_KEY"

echo "Container recreation complete!"
 