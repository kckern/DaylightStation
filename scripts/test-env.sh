#!/bin/bash
# scripts/test-env.sh
# Manage test Docker environment

set -e

COMPOSE_FILE="docker-compose.test.yml"
CONTAINER_NAME="daylight-test"

case "$1" in
  start)
    echo "Starting test environment..."
    docker-compose -f $COMPOSE_FILE up -d
    echo "Waiting for health check..."
    timeout 60 bash -c 'until curl -sf http://localhost:3113/api/v1/health; do sleep 2; done'
    echo "Test environment ready at http://localhost:3113"
    ;;
  stop)
    echo "Stopping test environment..."
    docker-compose -f $COMPOSE_FILE down
    ;;
  restart)
    $0 stop
    $0 start
    ;;
  status)
    docker-compose -f $COMPOSE_FILE ps
    ;;
  logs)
    docker-compose -f $COMPOSE_FILE logs -f
    ;;
  reset)
    echo "Resetting test data..."
    docker-compose -f $COMPOSE_FILE down -v
    npm run test:reset-data
    $0 start
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|reset}"
    exit 1
    ;;
esac
