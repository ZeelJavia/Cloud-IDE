# 🐳 DevDock - Cloud IDE Platform

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)
![React](https://img.shields.io/badge/React-18+-blue.svg)
![Docker](https://img.shields.io/badge/Docker-required-blue.svg)
![MongoDB](https://img.shields.io/badge/MongoDB-6.x-green.svg)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)
![GitHub stars](https://img.shields.io/github/stars/ZeelJavia/Codespace-Frontend?style=social)

**A modern, containerized web IDE platform with real-time collaboration, AI assistance, and multi-language support.**

[Features](#-features) • [Quick Start](#-quick-start) • [Demo](#-demo) • [Documentation](#-documentation) • [Contributing](#-contributing)

</div>

---

## 🌟 Features

### 🎨 **Modern Web IDE**

- **Monaco Editor** - Full VS Code editor experience in the browser
- **Multi-language Support** - JavaScript, Python, Java, C/C++, Go, Rust, and more
- **Syntax Highlighting** - Intelligent code highlighting and auto-completion
- **File Explorer** - Complete project file management

### 🐳 **Containerized Execution**

- **Isolated Environments** - Each project runs in its own Linux container
- **Multi-language Runtime** - Support for all major programming languages
- **Real-time Terminal** - Interactive terminal access to containers
- **Static Web Hosting** - Live preview for web projects on port 8088

### 🤖 **AI-Powered Development**

- **Code Generation** - AI-assisted code writing with Gemini API
- **Code Analysis** - Intelligent suggestions and improvements
- **Error Detection** - Smart error identification and fixes
- **Documentation** - Auto-generated code documentation

### 🔐 **Secure & Scalable**

- **JWT Authentication** - Secure user sessions
- **Google OAuth** - Social login integration
- **MongoDB Storage** - Persistent project and file storage
- **Real-time Sync** - Live collaboration with Socket.IO

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+**
- **Docker Desktop**
- **MongoDB** (local or cloud)

### 1. Clone & Install

```bash
# Clone the repository
git clone https://github.com/ZeelJavia/Codespace-Frontend.git
cd Codespace-Frontend

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Environment Setup

**Backend Configuration:**

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:

```env
PORT=3001
MONGODB_URI=mongodb://localhost:27017/devdock
JWT_SECRET=your-super-secret-key
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GEMINI_API_KEY=your-gemini-api-key
```

**Frontend Configuration:**

```bash
cd frontend
cp .env.example .env
```

Edit `frontend/.env`:

```env
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001
```

### 3. Database Setup

```bash
cd backend
node src/scripts/setup-mongo.js
```

### 4. Start Development

**Terminal 1 - Backend:**

```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**

```bash
cd frontend
npm run dev
```

🎉 **Access the IDE at http://localhost:3000**

## 📸 Demo

<div align="center">

### 🖥️ **IDE Interface**

_Monaco editor with file explorer, terminal, and AI assistance_

### 🐳 **Container Terminal**

_Real-time terminal access to isolated project containers_

### 🌐 **Web Preview**

_Live preview of web projects with instant updates_

</div>

## 🏗️ Project Structure

```
devdock-platform/
├── backend/                    # Express + MongoDB API
│   ├── src/
│   │   ├── controllers/        # API route handlers
│   │   ├── models/            # MongoDB schemas
│   │   ├── routes/            # Express routes
│   │   ├── services/          # Business logic
│   │   ├── middleware/        # Auth & validation
│   │   ├── config/           # App configuration
│   │   └── server.js         # Main server file
│   ├── package.json
│   └── .env.example
│
├── frontend/                   # React / Angular app
│   ├── src/
│   │   ├── components/        # UI components
│   │   ├── lib/              # API clients
│   │   └── main.jsx          # App entry point
│   ├── package.json
│   └── .env.example
│
├── db-backup/                  # Database dump or seed data
│   ├── test-*.json            # Sample data files
│   └── backup-server.js       # Database utilities
│
├── README.md                   # Setup instructions
└── .gitignore                  # Git ignore rules
```

## 🌟 Architecture Overview

## 🌟 Architecture Overview

```
🐳 DevDock Platform
├── 🎨 Frontend Layer (React + Vite)
│   ├── Monaco Editor Integration
│   ├── Real-time Socket.IO Client
│   ├── Project Management UI
│   └── Authentication System
│
├── 🚀 Backend Layer (Node.js + Express)
│   ├── RESTful API Endpoints
│   ├── Socket.IO Real-time Server
│   ├── Docker Container Management
│   ├── MongoDB Data Layer
│   └── AI Service Integration
│
├── 🐳 Container Infrastructure
│   ├── Per-project Linux Containers
│   ├── Volume-based File Storage
│   ├── Nginx Static Web Serving
│   └── Multi-language Runtime Support
│
└── 🗄️ Data Persistence
    ├── MongoDB Project Storage
    ├── User Authentication
    ├── File System Management
    └── Session Management
```

## 📚 Documentation

### 📖 **Setup Guides**

- [Backend Setup](./backend/README.md) - Complete backend installation and configuration
- [Frontend Setup](./frontend/README.md) - Frontend development and deployment

### 🔧 **API Documentation**

- **Authentication**: `/api/auth/*` - User registration, login, OAuth
- **Projects**: `/api/projects/*` - Project CRUD operations
- **Files**: `/api/projects/:name/files/*` - File management
- **AI**: `/api/ai/*` - Code generation and analysis

### 🎯 **Key Concepts**

- **Container Sessions** - Each project gets isolated environment
- **Real-time Sync** - Live file updates across clients
- **Fixed Port Strategy** - Web projects serve on port 8088
- **Volume Storage** - Persistent data in Docker volumes

## 🛠️ Technology Stack

### Frontend

- **React 18** - Modern UI library
- **Vite** - Fast build tool
- **Monaco Editor** - VS Code editor
- **Tailwind CSS** - Utility-first styling
- **Socket.IO Client** - Real-time communication

### Backend

- **Node.js & Express** - Server runtime
- **Socket.IO** - WebSocket server
- **MongoDB & Mongoose** - Database
- **Docker SDK** - Container management
- **JWT** - Authentication
- **Google OAuth** - Social login

### Infrastructure

- **Docker** - Containerization
- **Linux Containers** - Runtime environments
- **Nginx** - Static file serving
- **MongoDB** - Data persistence

## 🚀 Deployment

### 🐳 **Docker Deployment**

```bash
# Build and run with Docker Compose
docker-compose up -d
```

### ☁️ **Cloud Deployment**

**Backend Options:**

- **Railway** / **Render** - Node.js hosting
- **AWS EC2** - Full control
- **Digital Ocean** - Droplets

**Frontend Options:**

- **Vercel** / **Netlify** - Static hosting
- **AWS S3 + CloudFront** - CDN deployment

## 🤝 Contributing

We ❤️ contributions! Here's how to get started:

### 🐛 **Bug Reports**

1. Search existing issues
2. Create detailed bug report
3. Include reproduction steps

### ✨ **Feature Requests**

1. Check roadmap for planned features
2. Open feature request issue
3. Discuss implementation approach

### 💻 **Code Contributions**

1. **Fork** the repository
2. **Create** feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** changes (`git commit -m 'Add amazing feature'`)
4. **Push** to branch (`git push origin feature/amazing-feature`)
5. **Open** Pull Request

### 📋 **Development Guidelines**

- Follow existing code style
- Add tests for new features
- Update documentation
- Test across different environments

## 🔒 Security

- **Input Validation** - All API inputs sanitized
- **Authentication** - JWT + OAuth secure sessions
- **Container Isolation** - Projects run in isolated environments
- **CORS Protection** - Cross-origin request security
- **Environment Variables** - Sensitive data protection

## 📊 Performance

- **Container Optimization** - Efficient resource usage
- **File Caching** - Fast file access
- **Socket Optimization** - Minimal real-time latency
- **Build Optimization** - Vite fast builds
- **Database Indexing** - Optimized queries

## 🐛 Troubleshooting

### Common Issues

**🐳 Docker Connection Failed**

```bash
# Check Docker daemon
docker info

# Verify Docker permissions
docker run hello-world
```

**🗄️ MongoDB Connection Error**

```bash
# Local MongoDB
brew services start mongodb/brew/mongodb-community

# Or use MongoDB Atlas cloud service
```

**🌐 Port Already in Use**

```bash
# Kill process on port 3001
lsof -ti:3001 | xargs kill -9

# Or change port in .env file
```

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **VS Code Team** - Monaco Editor inspiration
- **Docker** - Containerization technology
- **React Team** - Frontend framework
- **MongoDB** - Database technology
- **Open Source Community** - Various tools and libraries

## 🌐 Links

- **GitHub Repository**: [Codespace-Frontend](https://github.com/ZeelJavia/Codespace-Frontend)
- **Documentation**: [Wiki](https://github.com/ZeelJavia/Codespace-Frontend/wiki)
- **Issues**: [Bug Reports](https://github.com/ZeelJavia/Codespace-Frontend/issues)
- **Discussions**: [Community](https://github.com/ZeelJavia/Codespace-Frontend/discussions)

---

<div align="center">
  <strong>⭐ Star this repo if you find it useful! ⭐</strong>
  
  Built with ❤️ for the developer community
</div>
