package config

import (
	"log"
	"os"
	"strconv"
	"strings"
)

// Config holds all runtime configuration, populated from environment variables.
type Config struct {
	// Port the server listens on. Env: PORT. Default: 8080.
	Port int

	// AllowedOrigins for WebSocket connections (comma-separated).
	// Env: ALLOWED_ORIGINS. Default: "*" (allow all — dev only).
	AllowedOrigins []string

	// StaticDir is the directory to serve frontend assets from.
	// Env: STATIC_DIR. Default: auto-detect ../client/dist or ../client.
	StaticDir string

	// Environment name: "development" or "production".
	// Env: ENV. Default: "development".
	Env string
}

// Load reads configuration from environment variables with sensible defaults.
func Load() *Config {
	cfg := &Config{
		Port:           getEnvInt("PORT", 8080),
		AllowedOrigins: getEnvList("ALLOWED_ORIGINS", []string{"*"}),
		StaticDir:      getEnvStr("STATIC_DIR", ""),
		Env:            getEnvStr("ENV", "development"),
	}

	// Auto-detect static dir if not explicitly set
	if cfg.StaticDir == "" {
		if _, err := os.Stat("../client/dist"); err == nil {
			cfg.StaticDir = "../client/dist"
		} else if _, err := os.Stat("./client/dist"); err == nil {
			cfg.StaticDir = "./client/dist"
		} else if _, err := os.Stat("../client"); err == nil {
			cfg.StaticDir = "../client"
		} else {
			cfg.StaticDir = "./public"
		}
	}

	cfg.log()
	return cfg
}

// IsProduction returns true if running in production mode.
func (c *Config) IsProduction() bool {
	return c.Env == "production"
}

// AllowsAllOrigins returns true if the origin allowlist is ["*"].
func (c *Config) AllowsAllOrigins() bool {
	return len(c.AllowedOrigins) == 1 && c.AllowedOrigins[0] == "*"
}

// IsOriginAllowed checks if a given origin is in the allowlist.
func (c *Config) IsOriginAllowed(origin string) bool {
	if c.AllowsAllOrigins() {
		return true
	}
	for _, allowed := range c.AllowedOrigins {
		if strings.EqualFold(origin, allowed) {
			return true
		}
	}
	return false
}

func (c *Config) log() {
	log.Printf("[config] env=%s port=%d static_dir=%s", c.Env, c.Port, c.StaticDir)
	if c.AllowsAllOrigins() {
		if c.IsProduction() {
			log.Println("[config] WARNING: ALLOWED_ORIGINS=* in production — set explicit origins!")
		} else {
			log.Println("[config] allowed_origins=* (development mode)")
		}
	} else {
		log.Printf("[config] allowed_origins=%v", c.AllowedOrigins)
	}
}

// --- helpers ---

func getEnvStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			log.Printf("[config] invalid %s=%q, using default %d", key, v, fallback)
			return fallback
		}
		return n
	}
	return fallback
}

func getEnvList(key string, fallback []string) []string {
	if v := os.Getenv(key); v != "" {
		parts := strings.Split(v, ",")
		result := make([]string, 0, len(parts))
		for _, s := range parts {
			s = strings.TrimSpace(s)
			if s != "" {
				result = append(result, s)
			}
		}
		if len(result) > 0 {
			return result
		}
	}
	return fallback
}
