import { useState } from "react";
import "./auth-page.css"; // Component-scoped styles
import { api, tokenManager } from "@/lib/api.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowLeft,
  Sparkles,
  Chrome,
  Code,
  Star,
  Database,
  Terminal,
  Layers,
} from "lucide-react";
import { useTheme } from "@/theme-context.jsx";

export function AuthPage({ onLogin, onBackToHome }) {
  const [isLogin, setIsLogin] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
    name: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  useTheme();

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (error) setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isLogin && formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      let data;
      if (isLogin) {
        data = await api.login({
          email: formData.email,
          password: formData.password,
        });
      } else {
        data = await api.register({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          confirmPassword: formData.confirmPassword,
        });
      }
      const { token, user } = data;
      if (token && user) {
        tokenManager.setToken(token);
        // Pass user data with token included
        onLogin({ ...user, token });
      } else {
        throw new Error("Invalid response from server");
      }
    } catch (e) {
      const msg =
        (e && e.data && (e.data.error || e.data.message)) ||
        e.message ||
        "Authentication failed. Please try again.";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleAuth = () => {
    window.location.href = api.googleLoginUrl();
  };

  return (
    <div className="auth-page min-h-screen bg-gradient-to-br from-background via-muted/20 to-background overflow-hidden">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-20 left-16 ap-animate-float">
          <Code
            className="w-6 h-6 text-green-500/40"
            style={{ animationDuration: "6s" }}
          />
        </div>
        <div className="absolute top-32 right-20">
          <Star
            className="w-5 h-5 text-yellow-500/40 ap-animate-float"
            style={{ animationDuration: "8s", animationDelay: "1s" }}
          />
        </div>
        <div className="absolute top-64 left-32">
          <Terminal
            className="w-4 h-4 text-blue-500/40 ap-animate-float"
            style={{ animationDuration: "7s", animationDelay: "2s" }}
          />
        </div>
        <div className="absolute top-48 right-32">
          <Database
            className="w-5 h-5 text-purple-500/40 ap-animate-float"
            style={{ animationDuration: "9s", animationDelay: ".5s" }}
          />
        </div>
        <div className="absolute bottom-32 left-20">
          <Layers
            className="w-6 h-6 text-teal-500/40 ap-animate-float"
            style={{ animationDuration: "6.5s", animationDelay: "1.5s" }}
          />
        </div>
        <div className="absolute bottom-48 right-16">
          <Code
            className="w-4 h-4 text-orange-500/40 ap-animate-float"
            style={{ animationDuration: "8.5s", animationDelay: "3s" }}
          />
        </div>
        <div
          className="absolute top-40 left-1/4 w-2 h-2 bg-primary/30 rounded-full ap-animate-pulse-glow"
          style={{ animationDuration: "3s" }}
        ></div>
        <div
          className="absolute top-72 right-1/4 w-3 h-3 bg-accent/30 rotate-45 ap-animate-pulse-glow"
          style={{ animationDuration: "4s", animationDelay: "1s" }}
        ></div>
        <div
          className="absolute bottom-40 left-1/3 w-1 h-1 bg-green-500/40 rounded-full ap-animate-pulse-glow"
          style={{ animationDuration: "2.5s", animationDelay: "2s" }}
        ></div>
      </div>

      <div className="absolute top-4 left-4 z-50">
        <Button
          variant="outline"
          onClick={onBackToHome}
          className="ap-glass ap-hover-lift bg-transparent"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Home
        </Button>
      </div>

      <div className="relative min-h-screen flex items-center justify-center px-4 py-20">
        <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="text-center lg:text-left ap-animate-slide-in-up">
            <Badge
              variant="secondary"
              className="mb-6 px-4 py-2 text-sm font-medium ap-glass ap-animate-pulse-glow text-foreground"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Welcome to the Future
            </Badge>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 text-balance">
              Cloud Native
              <span className="block bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent animate-gradient bg-[length:200%_auto]">
                Developer Workspace
              </span>
            </h1>
            <p className="text-xl text-muted-foreground mb-8 text-pretty">
              Code, collaborate, and create in the cloud. Your complete
              development environment, powered by AI, accessible from anywhere.
            </p>
          </div>

          <div
            className="w-full max-w-md mx-auto ap-animate-slide-in-up"
            style={{ animationDelay: ".2s" }}
          >
            <Card className="ap-glass border-2 border-primary/20 shadow-2xl shadow-primary/10 ap-hover-lift">
              <CardHeader className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                  <Sparkles className="w-8 h-8 text-primary" />
                </div>
                <CardTitle className="text-2xl font-bold">
                  {isLogin ? "Welcome Back" : "Get Started"}
                </CardTitle>
                <p className="text-muted-foreground">
                  {isLogin
                    ? "Sign in to access your workspace"
                    : "Join thousands of developers coding in the cloud"}
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex rounded-lg bg-muted p-1">
                  <button
                    type="button"
                    className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                      isLogin
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setIsLogin(true)}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                      !isLogin
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setIsLogin(false)}
                  >
                    Sign Up
                  </button>
                </div>
                {error && (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                    {error}
                  </div>
                )}
                <form onSubmit={handleSubmit} className="space-y-4">
                  {!isLogin && (
                    <div className="space-y-2">
                      <Label htmlFor="name">Full Name</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="name"
                          name="name"
                          type="text"
                          placeholder="Enter your full name"
                          value={formData.name}
                          onChange={handleInputChange}
                          className="pl-10"
                          required
                        />
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        placeholder="Enter your email"
                        value={formData.email}
                        onChange={handleInputChange}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter your password"
                        value={formData.password}
                        onChange={handleInputChange}
                        className="pl-10 pr-10"
                        required
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  {!isLogin && (
                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">Confirm Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="confirmPassword"
                          name="confirmPassword"
                          type={showConfirmPassword ? "text" : "password"}
                          placeholder="Confirm your password"
                          value={formData.confirmPassword}
                          onChange={handleInputChange}
                          className="pl-10 pr-10"
                          required
                        />
                        <button
                          type="button"
                          className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setShowConfirmPassword(!showConfirmPassword)
                          }
                        >
                          {showConfirmPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                  <Button
                    type="submit"
                    className="w-full bg-gradient-to-r from-primary to-accent hover:shadow-lg hover:shadow-primary/25 transition-all duration-300"
                    disabled={isLoading}
                  >
                    {isLoading
                      ? "Processing..."
                      : isLogin
                      ? "Sign In"
                      : "Create Account"}
                  </Button>
                </form>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">
                      Or continue with
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleGoogleAuth}
                  className="w-full ap-glass ap-hover-lift bg-transparent"
                >
                  <Chrome className="w-4 h-4 mr-2" />
                  Google
                </Button>
                {isLogin && (
                  <div className="text-center">
                    <button
                      type="button"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Forgot your password?
                    </button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
