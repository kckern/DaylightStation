docker build -t kckern/daylight-station:latest .
docker stop DaylightStation
docker rm DaylightStation


# build from docker-compose.yml
docker-compose build
docker-compose up -d


##push to hub
#docker push kckern/daylight-station:latest
