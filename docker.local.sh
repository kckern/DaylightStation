docker build -t kckern/daylight-station:latest .
docker stop DaylightStation
docker rm DaylightStation
docker run --env-file .env -p 8181:81 -d --name DaylightStation kckern/daylight-station:latest
