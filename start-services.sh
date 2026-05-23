#!/bin/sh

echo "Starting Mailman services..."

# Set environment variables
export FRONTEND_PORT=3000
export BACKEND_PORT=8080
export SERVER_PORT=8080

# Create log directories
mkdir -p /tmp

# Start nginx in background
nginx -g "daemon off;" &
NGINX_PID=$!

# Start mailman backend in background
/usr/local/bin/mailman &
MAILMAN_PID=$!

# Start frontend in background
cd /app/frontend
PORT=$FRONTEND_PORT HOSTNAME=127.0.0.1 node server.js &
FRONTEND_PID=$!

echo "All services started. PIDs: nginx=$NGINX_PID, mailman=$MAILMAN_PID, frontend=$FRONTEND_PID"

# Function to handle shutdown
cleanup() {
    echo "Shutting down services..."
    kill $NGINX_PID $MAILMAN_PID $FRONTEND_PID 2>/dev/null
    exit 0
}

# Setup signal handlers
trap cleanup SIGTERM SIGINT

# Wait for any service to exit
wait