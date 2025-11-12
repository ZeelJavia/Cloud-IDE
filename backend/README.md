# 🐳 DevDock Backend

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)
![Express](https://img.shields.io/badge/Express-4.x-blue.svg)
![MongoDB](https://img.shields.io/badge/MongoDB-6.x-green.svg)
![Docker](https://img.shields.io/badge/Docker-required-blue.svg)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)

**A containerized web IDE backend with MongoDB integration and Docker-based execution environments.**

[Features](#-features) • [Quick Start](#-quick-start) • [API](#-api-reference) • [Architecture](#-architecture) • [Contributing](#-contributing)

</div>

---

## ✨ Features

- 🐳 **Container-based execution**: Per-project Linux containers with volume mounting
- 🗄️ **MongoDB project storage**: Database-backed projects with in-container file population
- 🌐 **Multi-language support**: JavaScript, Python, Java, C/C++, Go, Rust, and more
- 🖥️ **Static web serving**: Nginx containers for web project hosting on fixed port 8088
- ⚡ **Socket.IO real-time**: Terminal interaction and file operations
- 🔐 **JWT authentication**: Secure user sessions with Google OAuth support
- 🤖 **AI integration**: Code generation and assistance with Gemini API
- 📁 **File management**: Complete CRUD operations with real-time sync

## 🚀 Quick Start

### 📋 Prerequisites

- **Node.js 18+** and npm
- **Docker Desktop** (for container execution)
- **MongoDB** (local or cloud)

### ⚡ Installation

1. **Clone and install dependencies**

```bash
cd backend
npm install
```

2. **Environment setup**

```bash
npm run setup
```

This creates `.env` from `.env.example`. Edit `.env` with your configuration:

```env
# Database
MONGODB_URI=mongodb://localhost:27017/devdock

# JWT Secret
JWT_SECRET=your-secure-jwt-secret

# Optional: AI features
GEMINI_API_KEY=your-gemini-api-key
AI_MODEL=gemini-2.5-flash

# Google OAuth (optional but recommended)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
BASE_URL=http://localhost:3001
FRONTEND_URL=http://localhost:3000

# Optional: Frontend origins (comma-separated)
FRONTEND_ORIGINS=http://localhost:3000,http://localhost:5173

# Container settings
WEB_PORT=8088
IN_CONTAINER_DB_FETCH=true
```

3. **Database initialization**

```bash
# Setup MongoDB with indexes and optional admin user
npm run db:setup -- --admin-email admin@example.com --seed-project

# Or with custom settings
npm run db:setup -- --uri "mongodb://localhost:27017/devdock" --admin-email admin@example.com --admin-password secret --seed-project --project-name "sample project"
```

4. **Start the server**

```bash
npm start
# or for development with auto-reload
npm run dev
```

Server runs on http://localhost:3001

## Google OAuth Setup (Optional)

To enable Google authentication, you'll need to set up a Google OAuth2 application:

### 1. Create Google OAuth2 Credentials

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API:
   - Go to "APIs & Services" > "Library"
   - Search for "Google+ API" and enable it
4. Create OAuth2 credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth 2.0 Client IDs"
   - Select "Web application"
   - Add authorized redirect URIs:
     - `http://localhost:3001/api/auth/google/callback` (development)
     - `https://yourdomain.com/api/auth/google/callback` (production)

### 2. Configure Environment

Add the credentials to your `.env`:

```env
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here
BASE_URL=http://localhost:3001
FRONTEND_URL=http://localhost:3000
```

### 3. Test OAuth

1. Start the backend: `npm start`
2. Check OAuth status: `GET http://localhost:3001/api/auth/google/status`
3. Test login flow: `GET http://localhost:3001/api/auth/google`

### 4. Frontend Integration

The OAuth flow redirects to your frontend with URL parameters:

**Success:**

```
http://localhost:3000?token=jwt-token&user={"id":"...","name":"...","email":"..."}
```

**Error:**

```
http://localhost:3000?error=auth_failed
```

Your frontend should extract and store the JWT token for API calls.

## 🏗️ Architecture

### 📁 Project Structure

```
backend/
├── src/
│   ├── server.js              # Main server entry point
│   ├── runner.js              # Multi-language file execution
│   ├── config/
│   │   ├── index.js           # Configuration management
│   │   └── database.js        # MongoDB connection
│   ├── controllers/           # Route handlers
│   ├── middleware/            # Auth, CORS, error handling
│   ├── models/                # MongoDB schemas
│   │   ├── User.js
│   │   ├── Project.js
│   │   └── File.js
│   ├── routes/                # API endpoints
│   ├── services/              # Business logic
│   │   └── containerService.js # Docker container management
│   ├── socket/                # Socket.IO handlers
│   ├── scripts/               # Setup utilities
│   │   └── setup-mongo.js
│   ├── tests/                 # Test suite
│   └── utils/                 # Helper functions
├── package.json
├── .env.example
└── README.md
```

### Container Architecture

Each project gets:

1. **Dev Container**: Long-running Linux container for terminal commands

   - Base: `ubuntu:22.04` (configurable via `DOCKER_BASE_IMAGE`)
   - Mount: Docker volume with project files populated from MongoDB
   - Port: Random host port mapped to 8080 for internal servers

2. **Web Container**: Nginx container for static file serving
   - Base: `nginx:alpine`
   - Mount: Same project volume (read-only)
   - Port: Fixed host port 8088 (`WEB_PORT`)
   - Config: SPA fallback to `index.html`

### Database Schema

**Users**

```javascript
{
  name: String,
  email: String (unique),
  password: String, // bcrypt hash
  provider: "local" | "google",
  googleId: String
}
```

**Projects**

```javascript
{
  owner: ObjectId (User),
  name: String
}
// Unique index: owner + name
```

**Files**

```javascript
{
  project: ObjectId (Project),
  path: String, // relative path within project
  name: String,
  type: "file" | "folder",
  content: String, // file contents
  size: Number
}
// Unique index: project + path
```

## 📚 API Reference

### Authentication

- `POST /api/auth/register` - Create account with email/password
- `POST /api/auth/login` - Login with email/password
- `GET /api/auth/verify` - Verify JWT token and get user info
- `POST /api/auth/logout` - Logout (client-side token removal)

#### Google OAuth

- `GET /api/auth/google/status` - Check OAuth configuration status
- `GET /api/auth/google` - Initiate Google OAuth flow (redirects to Google)
- `GET /api/auth/google/callback` - OAuth callback handler (internal use)

### Projects

- `GET /api/projects` - List user projects
- `POST /api/projects` - Create project
- `GET /api/projects/:name` - Get project details
- `DELETE /api/projects/:name` - Delete project

### Files

- `GET /api/projects/:name/files` - List project files
- `GET /api/projects/:name/files/*` - Get file content
- `PUT /api/projects/:name/files/*` - Create/update file
- `DELETE /api/projects/:name/files/*` - Delete file

### Execution

- Socket events for terminal interaction:
  - `init-container-terminal` - Create project container
  - `execute-container-command` - Run command in container
  - `start-web-server` - Launch nginx web server

### Web Serving

- `GET /web/:projectName/*` - Static file serving
- `GET /` or `/index.html` - Root serves active project
- All web projects served at http://localhost:8088

## Configuration Options

### Environment Variables

| Variable                | Default      | Description                         |
| ----------------------- | ------------ | ----------------------------------- |
| `PORT`                  | 3001         | Backend server port                 |
| `WEB_PORT`              | 8088         | Fixed web serving port              |
| `MONGODB_URI`           | -            | MongoDB connection string           |
| `JWT_SECRET`            | -            | JWT signing secret                  |
| `NODE_ENV`              | development  | Environment                         |
| `IN_CONTAINER_DB_FETCH` | true         | Populate files in container volume  |
| `MATERIALIZE_DB_TO_FS`  | false        | Mirror DB files to backend/projects |
| `USE_DB_PROJECTS`       | auto         | Enable MongoDB project storage      |
| `DOCKER_BASE_IMAGE`     | ubuntu:22.04 | Container base image                |

### Container Settings

- Container TTL: 10 minutes idle timeout
- Volume cleanup: On session end
- Port allocation: Random for dev, fixed 8088 for web
- SPA support: Fallback to index.html for 404s

## Development

### Running Tests

```bash
npm test                 # Run all tests
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests
npm run test:api         # API endpoint tests
```

### Docker Requirements

Ensure Docker Desktop is running. The backend automatically:

- Pulls required base images
- Creates/manages project volumes
- Handles container lifecycle
- Cleans up on session end

### Debugging

Enable verbose logging:

```env
DEBUG_WEB=true
```

Debug endpoints available at:

- `GET /api/debug/web-status` - Web serving status
- `GET /api/debug/container-sessions` - Active container list
- `GET /api/debug/web-container?terminalId=X` - Container logs

## Deployment

### Production Setup

1. Use production MongoDB (Atlas, etc.)
2. Set strong JWT_SECRET
3. Configure FRONTEND_ORIGINS
4. Consider Docker volume persistence
5. Set up reverse proxy for HTTPS

### Docker Compose Example

```yaml
version: "3.8"
services:
  backend:
    build: .
    ports:
      - "3001:3001"
      - "8088:8088"
    environment:
      - MONGODB_URI=mongodb://mongo:27017/devdock
      - JWT_SECRET=your-production-secret
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      - mongo

  mongo:
    image: mongo:7
    volumes:
      - mongo_data:/data/db
    ports:
      - "27017:27017"

volumes:
  mongo_data:
```

## Security Notes

- JWT tokens expire in 24h by default
- Container isolation via Docker
- File paths validated to prevent directory traversal
- MongoDB injection protection via Mongoose
- CORS configured for specified origins only

## Troubleshooting

### Common Issues

**Port 3001 already in use**

```bash
# Kill existing process
lsof -ti:3001 | xargs kill -9
# Or change PORT in .env
```

**Docker connection failed**

- Ensure Docker Desktop is running
- Check Docker socket permissions on Linux

**MongoDB connection failed**

- Verify MONGODB_URI in .env
- Ensure MongoDB is running
- Check network connectivity

**Container execution errors**

- Verify Docker base image is available
- Check Docker daemon status
- Review container logs via debug endpoints

### 🆘 Getting Help

1. Check debug endpoints for runtime state
2. Review server logs for error details
3. Verify environment configuration
4. Test Docker connectivity independently

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Development Guidelines

- Follow existing code style and structure
- Add tests for new features
- Update documentation for API changes
- Ensure Docker containers work across platforms

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Docker** - Containerization platform
- **MongoDB** - Database storage
- **Express.js** - Web framework
- **Socket.IO** - Real-time communication
- **Google OAuth** - Authentication service

---

<div align="center">
  <strong>Built with ❤️ for the developer community</strong>
</div>

For additional support, refer to the project repository or documentation.
