# DaylightStation

A comprehensive personal life management and wellness platform that aggregates data from multiple fitness, health, lifestyle, and productivity sources into a unified visualization and automation hub.

## Overview

DaylightStation is a full-stack Node.js application designed as a personal "operating system" for life tracking and optimization. It provides real-time fitness tracking with pose detection, health metrics aggregation, nutrition logging, financial management, media consumption tracking, and home automation—all in a single containerized platform designed for multi-user household scenarios.

## Key Features

### Fitness & Wellness
- **Real-time Fitness Tracking**: Multi-user session management with live metrics
- **Pose Detection**: TensorFlow.js-powered pose analysis using webcam
- **Activity Monitoring**: Integration with Strava, Garmin, and custom FitSync
- **Vibration Sensor Support**: MQTT-based device integration
- **Live Vitals Display**: Heart rate, calories, and performance metrics
- **Music Player Integration**: Synchronized workout music

### Health Tracking
- **Multi-Platform Integration**: Strava, Garmin, Withings, and FitSync
- **Comprehensive Metrics**: Sleep, weight, biometrics, and activity data
- **Historical Analysis**: Trend visualization and health insights

### Nutrition & Food
- **NutriBot**: AI-powered nutrition assistant via Telegram
- **Food Logging**: Barcode scanning with UPC lookup
- **Meal Planning**: Nutritional goal tracking and daily summaries
- **AI Coaching**: OpenAI-powered meal recommendations

### Financial Management
- **Buxfer Integration**: Expense tracking and budget management
- **Financial Reports**: Transaction categorization and analysis
- **Bank Sync**: Automated transaction importing

### Lifestyle & Entertainment
- **Plex Integration**: Media server streaming and consumption tracking
- **YouTube Integration**: Video playback with yt-dlp support
- **Last.fm**: Music listening history
- **Smart TV Support**: Kiosk mode and Tasker integration

### Productivity
- **Todoist**: Task tracking and management
- **Google Calendar**: Event scheduling and reminders
- **Gmail**: Email integration and summaries
- **ClickUp**: Project management
- **GitHub**: Development activity tracking

### Home Automation
- **Home Assistant Integration**: Smart home device control
- **MQTT Support**: IoT device communication
- **Scene Automation**: Household automation triggers

### Lifelog & Data Aggregation
Unified life event extraction from all integrated services:
- Calendar events, fitness activities, meals, location check-ins
- Shopping/purchases, health metrics, music listening
- Social media (Reddit), productivity tools, email
- Entertainment consumption (Last.fm, Plex)

### AI & Intelligence
- **OpenAI GPT Integration**: Conversational features and recommendations
- **Token Optimization**: Smart API usage with conversation state management
- **Nutrition Coaching**: AI-powered meal planning assistance

### Additional Features
- **Thermal Printer Support**: Physical receipts and logs
- **Shopping List Management**: Barcode integration
- **Weather Data**: Geographic weather information
- **Multi-Household Support**: User isolation with household-based data organization
- **WebSocket Communication**: Real-time updates across all clients

## Technology Stack

### Frontend
- **React** 18.3.1 with React Router v6
- **Vite** 5.1.4 (build tool)
- **Mantine UI** 7.11.1 (component library)
- **TensorFlow.js** 4.22.0 (pose detection)
- **Highcharts** & **Recharts** (data visualization)
- **Video.js** & **React Player** (media playback)
- **SCSS** (styling)

### Backend
- **Node.js** 20.11.0
- **Express.js** 4.18.2
- **WebSocket** (ws 8.18.1)
- **MySQL2** 3.12.0
- **OpenAI API** 4.77.0
- **Winston** 3.18.3 (logging with Loggly support)
- **MQTT** 5.14.1 (IoT messaging)
- **Axios** 1.4.0

### Infrastructure
- **Docker** (Alpine Linux)
- **Docker Compose** (orchestration)
- **HTTPS/WSS** support
- **PM2** (process management)

## Prerequisites

- **Node.js** 20.11.0 or higher
- **Docker** and **Docker Compose** (for containerized deployment)
- **MySQL** database (for relational data)
- **yt-dlp** (for YouTube content extraction)

## Installation

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/DaylightStation.git
   cd DaylightStation
   ```

2. **Install root dependencies**
   ```bash
   npm install
   ```

3. **Install frontend dependencies**
   ```bash
   cd frontend
   npm install
   cd ..
   ```

4. **Install backend dependencies**
   ```bash
   cd backend
   npm install
   cd ..
   ```

### Docker Deployment

1. **Build the container**
   ```bash
   docker-compose -f docker/docker-compose.yml build
   ```

2. **Start the services**
   ```bash
   docker-compose -f docker/docker-compose.yml up -d
   ```

## Configuration

### Application Configuration

1. **Copy configuration templates**
   ```bash
   cp config/config.app.example.yml config.app.yml
   cp config/config.secrets.example.yml config.secrets.yml
   ```

2. **Edit configuration files**
   - `config.app.yml`: Application settings, feature flags, household configuration
   - `config.secrets.yml`: API keys, tokens, and credentials

### Environment Variables

Create a `.env` file in the root directory:
```bash
NODE_ENV=development
PORT=3112
FRONTEND_PORT=3111
```

### API Keys & Integrations

Configure the following services in `config.secrets.yml`:
- **Strava**: Client ID, client secret, refresh token
- **Garmin**: Username, password
- **Withings**: API credentials
- **OpenAI**: API key
- **Buxfer**: API credentials
- **Plex**: Server token and URL
- **Todoist**: API token
- **Google APIs**: Calendar, Gmail credentials
- **Last.fm**: API key
- **Home Assistant**: Access token
- **MQTT**: Broker credentials
- **Telegram**: Bot token (for NutriBot)

## Running the Application

### Development Mode

**Start both frontend and backend with hot reload:**
```bash
npm run start:dev
```

Or run them separately:

**Backend only:**
```bash
npm run backend:dev
```

**Frontend only:**
```bash
npm run frontend:dev
```

### Production Mode

**Start both services:**
```bash
npm start
```

**Backend only:**
```bash
npm run backend
```

### Access Points

- **Frontend**: http://localhost:3111
- **Backend API**: http://localhost:3112
- **Docker Proxy**: http://localhost:3113 (when using Docker)

## Project Structure

```
DaylightStation/
├── backend/                    # Node.js Express backend
│   ├── index.js                # Main server entry point
│   ├── api.mjs                 # API router
│   ├── routers/                # Express routers (fitness, media, health, etc.)
│   ├── lib/                    # Core utilities and service integrations
│   ├── chatbots/               # Chatbot framework (NutriBot, HomeBot, Journalist)
│   ├── jobs/                   # Background jobs
│   ├── tests/                  # Test files
│   └── scripts/                # Utility scripts
│
├── frontend/                   # React frontend
│   ├── src/
│   │   ├── Apps/               # Top-level application views
│   │   ├── modules/            # Feature modules (Fitness, Health, Finance, etc.)
│   │   ├── context/            # React context providers
│   │   ├── hooks/              # Custom React hooks
│   │   └── lib/                # Frontend utilities
│   └── public/                 # Static assets
│
├── config/                     # Configuration templates
├── docker/                     # Docker configuration
│   ├── Dockerfile              # Container image definition
│   ├── docker-compose.yml      # Container orchestration
│   └── docker-compose.remote.yml
├── docs/                       # Documentation
├── scripts/                    # Utility scripts
├── cli/                        # Command-line interface
├── _extensions/                # Satellite components (ANT+, MIDI)
│
└── package.json                # Root workspace package
```

## Development

### Running Tests

**All tests:**
```bash
npm test
```

**Harvest tests:**
```bash
npm run test:harvest
```

**NutriBot tests:**
```bash
npm run test:nutribot
```

**Live API tests:**
```bash
npm run test:strava:live
npm run test:garmin:live
npm run test:fitsync:live
```

**Watch mode:**
```bash
npm run test:watch
```

**Coverage:**
```bash
npm run test:coverage
```

### Linting

```bash
cd frontend
npm run lint
```

## Chatbots

DaylightStation includes a modular chatbot framework with Telegram integration:

### NutriBot
Nutrition tracking assistant with:
- Meal logging and barcode scanning
- AI-powered nutrition coaching
- Daily summaries and goal tracking
- Recipe recommendations

### Journalist
Food logging companion with:
- Quick meal entry
- UPC barcode lookup
- Nutritional analysis

### HomeBot
Household automation assistant for:
- Smart device control
- Scene activation
- Home status updates

## Architecture Patterns

- **Router-Based Backend**: Express routers for different domains
- **Modular Chatbot Framework**: DI container with clean architecture
- **Lifelog Extraction**: Plugin-style extractors for life events
- **Multi-Household Multi-User**: Data scoped by household and user
- **Gateway Pattern**: External API integration through adapters
- **Real-time Communication**: WebSocket for live updates
- **File-Based Configuration**: YAML with environment overrides
- **Unified Logging**: Centralized logging with multiple transports

## Docker Support

The application is fully containerized. Docker files are in the `docker/` folder:

```bash
# Build the image
docker-compose -f docker/docker-compose.yml build

# Start services
docker-compose -f docker/docker-compose.yml up -d

# View logs
docker-compose -f docker/docker-compose.yml logs -f

# Stop services
docker-compose -f docker/docker-compose.yml down
```

## Multi-User & Household Support

DaylightStation supports multiple households with individual users:

- Data organized by household ID
- User-specific data isolation
- Configurable household head for default operations
- Per-user authentication and preferences

## Logging & Monitoring

- **Winston** logging with multiple transports
- **Loggly** integration for cloud logging
- Environment-specific log levels
- Frontend-to-backend log ingestion
- JSON and pretty-printed console output

## Security Considerations

- **API Key Management**: Store secrets in `config.secrets.yml` (excluded from git)
- **Environment Variables**: Use `.env` for sensitive configuration
- **HTTPS/WSS**: Enable SSL for production deployments
- **User Authentication**: Household-based access control
- **Data Privacy**: Per-user data isolation

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License.

## Acknowledgments

- Built with Node.js, React, and TensorFlow.js
- Integrates with Strava, Garmin, Withings, Plex, OpenAI, and many other services
- Designed for personal wellness and life optimization

---

**DaylightStation** - Your personal life management operating system.