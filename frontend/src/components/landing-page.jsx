import { useEffect, useState } from "react";
import "./landing-page.css"; // Component-scoped styles
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Code2,
  Zap,
  Globe,
  Users,
  Shield,
  ArrowRight,
  Sparkles,
  Terminal,
  GitBranch,
  Layers,
  Moon,
  Sun,
} from "lucide-react";
import { useTheme } from "@/theme-context.jsx";

export function LandingPage({ onGetStarted, onLogin }) {
  const [isVisible, setIsVisible] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setIsVisible(true);
    const handler = (e) => setMousePosition({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, []);

  const features = [
    {
      icon: <Code2 className="w-8 h-8" />,
      title: "Full IDE Experience",
      description:
        "Complete development environment with syntax highlighting, IntelliSense, and debugging capabilities.",
    },
    {
      icon: <Layers className="w-8 h-8" />,
      title: "Docker Integration",
      description:
        "Secure, containerized code execution with support for 10+ programming languages.",
    },
    {
      icon: <Sparkles className="w-8 h-8" />,
      title: "AI Assistant",
      description:
        "Get code suggestions, generate boilerplate, and solve problems with our intelligent AI companion.",
    },
    {
      icon: <Terminal className="w-8 h-8" />,
      title: "Real-time Terminal",
      description:
        "Integrated terminal with full shell access and real-time command execution.",
    },
    {
      icon: <Users className="w-8 h-8" />,
      title: "Live Collaboration",
      description:
        "Work together in real-time with instant file synchronization and shared workspaces.",
    },
    {
      icon: <Shield className="w-8 h-8" />,
      title: "Secure & Isolated",
      description:
        "Your code runs in secure containers with proper isolation and safety measures.",
    },
  ];

  const codeSnippets = [
    "const workspace = new CloudIDE()",
    "git commit -m 'feat: ai integration'",
    "npm run deploy --cloud",
    "docker build -t myapp .",
    "function collaborate() {}",
    "export default Component",
  ];

  return (
    <div className="landing-page min-h-screen bg-gradient-to-br from-background via-muted/30 to-background overflow-hidden">
      <div className="fixed top-4 right-4 z-50">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="lp-glass lp-hover-lift"
        >
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </div>

      <div className="fixed inset-0 pointer-events-none">
        <div
          className="absolute inset-0 bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5 lp-animate-gradient"
          style={{
            background: `radial-gradient(circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(22, 78, 99, 0.1) 0%, transparent 50%)`,
          }}
        />
        <div className="absolute inset-0">
          {codeSnippets.map((snippet, index) => (
            <div
              key={index}
              className="absolute text-muted-foreground/20 font-mono text-sm lp-animate-float opacity-30"
              style={{
                top: `${20 + index * 15}%`,
                left: `${10 + index * 12}%`,
                animationDelay: `${index * -1}s`,
                animationDuration: `${8 + index}s`,
              }}
            >
              {snippet}
            </div>
          ))}
        </div>
      </div>

      <section className="relative min-h-screen flex items-center justify-center px-4 py-20">
        <div
          className={`max-w-6xl mx-auto text-center transition-all duration-1000 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <Badge
            variant="secondary"
            className="mb-6 px-4 py-2 text-sm font-medium lp-glass lp-animate-pulse-glow text-foreground"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            AI-Powered Development
          </Badge>
          <h1 className="text-6xl md:text-7xl lg:text-8xl font-bold mb-6 text-balance">
            Cloud Native
            <span className="block bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent animate-gradient bg-[length:200%_auto]">
              Developer Workspace
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-3xl mx-auto text-pretty">
            Code, collaborate, and create in the cloud. Your complete
            development environment powered by AI, accessible from anywhere.
          </p>
          <div className="flex flex-wrap justify-center gap-4 mb-12">
            {[
              { icon: <Zap className="w-4 h-4" />, text: "Instant Setup" },
              { icon: <Sparkles className="w-4 h-4" />, text: "AI-Powered" },
              { icon: <Globe className="w-4 h-4" />, text: "Browser-Based" },
              {
                icon: <GitBranch className="w-4 h-4" />,
                text: "Real-time Collaboration",
              },
            ].map((feature, index) => (
              <div
                key={index}
                className="flex items-center gap-2 px-4 py-2 rounded-full lp-glass text-sm font-medium lp-hover-lift lp-animate-slide-in-up"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                {feature.icon}
                {feature.text}
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <Button
              size="lg"
              className="px-8 py-4 text-lg font-semibold rounded-full bg-gradient-to-r from-primary to-accent hover:shadow-2xl hover:shadow-primary/25 transition-all duration-300 group lp-hover-lift"
              onClick={onGetStarted}
            >
              Get Started Free
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="px-8 py-4 text-lg font-semibold rounded-full lp-glass hover:bg-muted/50 transition-all duration-300 bg-transparent lp-hover-lift"
              onClick={() => {
                const el = document.getElementById("features");
                el?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                  inline: "nearest",
                });
              }}
            >
              Learn More
            </Button>
          </div>
          <div className="relative max-w-4xl mx-auto">
            <Card className="lp-glass border-2 border-primary/20 shadow-2xl shadow-primary/10 lp-hover-lift">
              <CardContent className="p-8">
                <div className="bg-gradient-to-br from-muted/50 to-background rounded-lg p-6 font-mono text-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-3 h-3 rounded-full bg-destructive"></div>
                    <div className="w-3 h-3 rounded-full bg-accent"></div>
                    <div className="w-3 h-3 rounded-full bg-primary"></div>
                    <span className="ml-4 text-muted-foreground">
                      workspace.ts
                    </span>
                  </div>
                  <div className="space-y-2 text-left">
                    <div>
                      <span className="lp-syntax-keyword">import</span>{" "}
                      <span className="lp-syntax-variable">
                        {"{ CloudIDE }"}
                      </span>{" "}
                      <span className="lp-syntax-keyword">from</span>{" "}
                      <span className="lp-syntax-string">
                        '@ai-workspace/core'
                      </span>
                    </div>
                    <div>
                      <span className="lp-syntax-keyword">const</span>{" "}
                      <span className="lp-syntax-variable">workspace</span> ={" "}
                      <span className="lp-syntax-keyword">new</span>{" "}
                      <span className="lp-syntax-function">CloudIDE</span>()
                    </div>
                    <div>
                      <span className="lp-syntax-variable">workspace</span>.
                      <span className="lp-syntax-function">enableAI</span>()
                    </div>
                    <div>
                      <span className="lp-syntax-variable">workspace</span>.
                      <span className="lp-syntax-function">collaborate</span>(
                      <span className="lp-syntax-string">'team'</span>)
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section id="features" className="py-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <Badge variant="outline" className="mb-4 lp-glass">
              Features
            </Badge>
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Everything you need to code
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              A complete development environment with cutting-edge tools and AI
              assistance.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => (
              <Card
                key={index}
                className="group lp-glass hover:shadow-2xl hover:shadow-primary/10 transition-all duration-500 hover:-translate-y-2 border-primary/10 lp-hover-lift lp-animate-slide-in-up"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <CardContent className="p-8 text-center">
                  <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center text-primary group-hover:scale-110 transition-transform duration-300">
                    {feature.icon}
                  </div>
                  <h3 className="text-xl font-semibold mb-4">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <Card className="lp-glass border-2 border-primary/20 shadow-2xl shadow-primary/10 lp-hover-lift">
            <CardContent className="p-12">
              <h2 className="text-4xl md:text-5xl font-bold mb-6">
                Ready to transform your
                <span className="block bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  development workflow?
                </span>
              </h2>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
                Join thousands of developers who are already coding in the cloud
                with AI assistance.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button
                  size="lg"
                  className="px-8 py-4 text-lg font-semibold rounded-full bg-gradient-to-r from-primary to-accent hover:shadow-2xl hover:shadow-primary/25 transition-all duration-300 group lp-hover-lift"
                  onClick={onGetStarted}
                >
                  Start Building Now
                  <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="px-8 py-4 text-lg font-semibold rounded-full lp-glass bg-transparent lp-hover-lift"
                  onClick={onLogin}
                >
                  Sign In
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <footer className="py-16 px-4 border-t border-border/50">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div className="md:col-span-2">
              <h3 className="text-2xl font-bold mb-4 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Cloud Native Developer Workspace
              </h3>
              <p className="text-muted-foreground mb-4">
                Empowering developers worldwide with AI-powered cloud
                development tools.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <div className="space-y-2 text-muted-foreground">
                <div>Features</div>
                <div>Pricing</div>
                <div>Documentation</div>
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <div className="space-y-2 text-muted-foreground">
                <div>About</div>
                <div>Contact</div>
                <div>Privacy</div>
              </div>
            </div>
          </div>
          <div className="pt-8 border-t border-border/50 text-center text-muted-foreground">
            <p>© 2025 Cloud Native Developer Workspace. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
