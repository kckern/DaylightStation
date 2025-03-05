docker build -t kckern/daylight-station:latest .
docker stop daylight-station
docker rm daylight-station


#push to local registry
docker tag kckern/daylight-station:latest localhost:3113/daylight-station:latest




# build from docker-compose.yml
docker compose build
docker compose up -d




##push to hub
docker push kckern/daylight-station:latest
 