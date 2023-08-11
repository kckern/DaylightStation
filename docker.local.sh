docker build -t kckern/daylight-station:latest .
docker stop DaylightStation
docker rm DaylightStation
docker run --env-file .env -p 3113:3112 -d --name DaylightStation kckern/daylight-station:latest -v config.yml:/usr/src/app/config.yml

##push to hub
#docker push kckern/daylight-station:latest
