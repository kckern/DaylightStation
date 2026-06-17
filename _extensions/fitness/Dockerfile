FROM node:18-slim

# Install system dependencies for ANT+, serial communication, and Bluetooth.
# Fingerprint unlock (U.are.U 4500) runs ENTIRELY in-container via libfprint:
#   - libfprint-2-2     : fingerprint library (uru4000 driver for the 4500)
#   - gir1.2-fprint-2.0 : GObject-introspection typelib for the FPrint-2.0 namespace
#   - python3-gi / gir1.2-glib-2.0 : PyGObject runtime so the Python enroll/identify
#                         helper can `import gi; gi.require_version('FPrint','2.0')`
# The host carries NO fingerprint stack — it only passes the USB device through and
# mounts the template store. Host `fprintd` must be masked so it never claims the
# reader (libfprint permits a single claimant of the device).
# Verified to resolve + import on node:18-slim (Debian bookworm) before adding.
RUN apt-get update && apt-get install -y \
    usbutils \
    libusb-1.0-0-dev \
    libudev-dev \
    python3 \
    python3-pip \
    python3-venv \
    python3-gi \
    gir1.2-glib-2.0 \
    gir1.2-fprint-2.0 \
    libfprint-2-2 \
    bluez \
    bluetooth \
    libbluetooth-dev \
    libdbus-1-dev \
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

# Install Python BLE library (bleak)
RUN pip3 install --break-system-packages bleak

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
