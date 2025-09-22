FROM node:18-slim

# Install system dependencies for ANT+ and serial communication
RUN apt-get update && apt-get install -y \
    usbutils \
    libusb-1.0-0-dev \
    libudev-dev \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install node dependencies
RUN npm install

# Copy application code
COPY . .

# Create a non-root user for security
RUN groupadd -r fitnessuser && useradd -r -g fitnessuser fitnessuser

# Give the user access to USB devices (will be handled by docker-compose)
RUN usermod -a -G dialout,plugdev fitnessuser

# Change ownership of app directory
RUN chown -R fitnessuser:fitnessuser /usr/src/app

# Switch to non-root user
USER fitnessuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/status || exit 1

# Start the application
CMD ["npm", "start"]
