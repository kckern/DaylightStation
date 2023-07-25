#docker compose up --build
## build image and push to docker hub
docker build -t kckern/daylight-station:latest .
docker push kckern/daylight-station:latest
## run image
