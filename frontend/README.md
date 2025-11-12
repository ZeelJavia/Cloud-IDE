# 🎨 DevDock Frontend

<div align="center">

![React](https://img.shields.io/badge/React-18+-blue.svg)
![Vite](https://img.shields.io/badge/Vite-5.x-purple.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)
![Monaco Editor](https://img.shields.io/badge/Monaco_Editor-VS_Code-green.svg)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)

**Modern React-based web IDE frontend with real-time collaboration, containerized code execution, and AI assistance.**

[Features](#-features) • [Quick Start](#-quick-start) • [Architecture](#-architecture) • [Deployment](#-deployment) • [Contributing](#-contributing)

</div>

---

## ✨ Features

- ⌨️ **Monaco Editor**: Full-featured code editor with syntax highlighting
- 🌍 **Multi-language Support**: JavaScript, Python, Java, C/C++, Go, Rust, and more
- ⚡ **Real-time Terminal**: Socket.IO-based terminal with containerized execution
- 📁 **Project Management**: File explorer, project creation, and file operations
- 🤖 **AI Integration**: Code generation and assistance
- 🌐 **Web Preview**: Static site hosting with live preview
- 🔐 **Authentication**: JWT and Google OAuth support

## 🚀 Quick Start

### 📋 Prerequisites

- **Node.js 18+** and npm (or pnpm)
- **Backend server** running on http://localhost:3001

### ⚡ Installation

1. **Install dependencies**
```bash
cd frontend
npm install
```

2. **Environment setup**
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001
```

3. **Start development server**
```bash
npm run dev
```

Frontend runs on http://localhost:3000

4. **Build for production**
```bash
npm run build
npm run preview
```

## 🏗️ Architecture

### 📁 Project Structure

```
frontend/
├── src/
│   ├── App.jsx                 # Main app component
│   ├── main.jsx                # React entry point  
│   ├── index.css               # Global styles
│   ├── components/             # UI components
│   │   ├── MenuBar.jsx         # Top navigation
│   │   ├── FileExplorer.jsx    # Project file tree
│   │   ├── CodeEditor.jsx      # Monaco editor wrapper
│   │   ├── Terminal.jsx        # Terminal interface
│   │   ├── AIPanel.jsx         # AI assistance panel
│   │   ├── StatusBar.jsx       # Bottom status bar
│   │   ├── auth-page.jsx       # Login/register
│   │   ├── landing-page.jsx    # Welcome screen
│   │   └── ui/                 # Reusable UI components
│   ├── lib/
│   │   ├── api.js              # HTTP API client
│   │   └── utils.js            # Helper functions
│   └── theme-context.jsx       # Theme management
├── public/
│   └── manifest.json
├── package.json
├── vite.config.js              # Vite configuration
├── tailwind.config.js          # Tailwind CSS config
└── postcss.config.js           # PostCSS config
```

### 🧩 Component Architecture

**App.jsx** (Root)
- Authentication state management
- Socket.IO connection handling
- Global state (projects, files, editor)
- Route between landing/auth/IDE views

**MenuBar.jsx**
- Project operations (create, open, delete)
- User menu and logout
- Panel toggles (AI, terminal)

**FileExplorer.jsx** 
- Project file tree display
- File/folder creation and deletion
- File selection for editor

**CodeEditor.jsx**
- Monaco editor integration
- Multi-tab file editing
- Save/run operations
- Syntax highlighting

**Terminal.jsx**
- Socket.IO terminal interface
- Command execution and output streaming
- Container session management

**AIPanel.jsx**
- AI code generation
- File analysis and suggestions
- Integration with backend AI services

### 📊 State Management

- **Authentication**: JWT tokens in localStorage
- **Socket Connection**: Shared across components via props
- **File System**: Centralized in App.jsx, passed down
- **Editor State**: Monaco editor state in CodeEditor
- **Theme**: Context-based theme switching

### 🔌 API Integration

**HTTP Endpoints** (`src/lib/api.js`)
- Authentication: `/api/auth/*`
- Projects: `/api/projects/*` 
- Files: `/api/projects/:name/files/*`
- AI: `/api/ai/*`

**Socket Events**
- `join-project` / `leave-project` - Project room management
- `execute-container-command` - Terminal commands
- `run-file` / `run-container-file` - Code execution
- `start-web-server` - Static site hosting
- `terminal-output` - Command output streaming
- `file-updated` - Real-time file sync

## 💻 Development

### 📝 Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Production build
npm run preview      # Preview production build
```

### 🌍 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | http://localhost:3001 | Backend API base URL |
| `VITE_WS_URL` | ws://localhost:3001 | WebSocket URL for Socket.IO |

### 🎨 Styling

- **Tailwind CSS**: Utility-first CSS framework
- **CSS Modules**: Component-scoped styles where needed
- **Theme Support**: Dark/light mode via CSS variables

### ⌨️ Code Editor

- **Monaco Editor**: VS Code editor in the browser
- **Language Support**: Auto-detection and syntax highlighting
- **Multi-tab**: Multiple files open simultaneously
- **Auto-save**: Configurable save on change/focus loss

## 🚀 Deployment

### Production Build

```bash
npm run build
```

Outputs to `dist/` directory.

### Static Hosting

Deploy `dist/` to any static hosting service:

- **Vercel**: `vercel --prod`
- **Netlify**: Drag & drop `dist/` folder
- **GitHub Pages**: Push `dist/` to `gh-pages` branch
- **AWS S3**: Upload `dist/` contents to bucket

### Environment Configuration

For production, update environment variables:

```env
VITE_API_URL=https://api.yourapp.com
VITE_WS_URL=wss://api.yourapp.com
```

### Docker Deployment

```dockerfile
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

## Security

- **JWT Authentication**: Secure token-based auth
- **CORS Protection**: Backend CORS configuration
- **Input Sanitization**: XSS protection in file operations
- **CSP Headers**: Content Security Policy for production

## Performance

- **Code Splitting**: Vite automatic code splitting
- **Tree Shaking**: Remove unused code in production
- **Asset Optimization**: Image and font optimization
- **Socket Optimization**: Efficient real-time updates

## Browser Support

- **Modern Browsers**: Chrome 90+, Firefox 88+, Safari 14+
- **ES2020+**: Modern JavaScript features
- **Monaco Editor**: Same requirements as VS Code web

## Troubleshooting

### Common Issues

**Backend Connection Failed**
```bash
# Verify backend is running
curl http://localhost:3001/api/health

# Check VITE_API_URL in .env
```

**Socket.IO Connection Issues**
- Verify WebSocket URL in environment
- Check network/firewall restrictions
- Ensure backend Socket.IO is configured

**Monaco Editor Not Loading**
- Check browser console for errors
- Verify modern browser support
- Clear browser cache and reload

**Build Failures**
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Development Tips

1. **Hot Reload**: Vite provides instant hot module replacement
2. **DevTools**: React DevTools browser extension recommended
3. **Network Tab**: Monitor API calls and WebSocket connections
4. **Console Logs**: Check browser console for Socket.IO events

## Contributing

1. Follow existing code style and structure
2. Test changes across different browsers
3. Verify socket event handling works correctly
4. Check responsive design on mobile devices

## 🔗 Integration

The frontend is designed to work with the DevDock backend:

- **Authentication**: Compatible with JWT and Google OAuth
- **File Operations**: CRUD operations via REST API
- **Code Execution**: Container-based execution via sockets
- **Real-time Updates**: File changes broadcast to all clients
- **Web Hosting**: Static site preview on port 8088

Refer to the backend README for server setup and API documentation.

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Development Guidelines

- Follow existing code style and structure
- Test changes across different browsers
- Verify socket event handling works correctly
- Check responsive design on mobile devices
- Add tests for new components
- Update documentation for component changes

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **React** - UI library
- **Vite** - Build tool
- **Monaco Editor** - Code editor
- **Tailwind CSS** - Styling framework
- **Socket.IO** - Real-time communication

---

<div align="center">
  <strong>Built with ❤️ for developers, by developers</strong>
</div>
