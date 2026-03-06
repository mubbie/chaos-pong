package server

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/mubbie/chaos-pong/backend/internal/config"
	"github.com/mubbie/chaos-pong/backend/internal/ws"
)

// StatsProvider gives the server access to live stats.
type StatsProvider interface {
	ClientCount() int
	ActiveRoomCount() int
	QueueSize() int
}

// New creates and configures the HTTP server with all routes.
func New(hub *ws.Hub, router ws.MessageRouter, stats StatsProvider, cfg *config.Config) *http.Server {
	r := mux.NewRouter()
	setupRoutes(r, hub, router, stats, cfg)

	return &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.Port),
		Handler: r,
	}
}

func setupRoutes(r *mux.Router, hub *ws.Hub, router ws.MessageRouter, stats StatsProvider, cfg *config.Config) {
	r.HandleFunc("/api/health", handleHealth).Methods("GET")
	r.HandleFunc("/api/stats", handleStats(stats)).Methods("GET")
	r.HandleFunc("/ws", ws.HandleWebSocket(hub, router, cfg.IsOriginAllowed))

	// Serve frontend assets from the configured static directory
	fileServer := http.FileServer(http.Dir(cfg.StaticDir))
	r.PathPrefix("/").Handler(fileServer)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func handleStats(stats StatsProvider) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		clients := stats.ClientCount()
		rooms := stats.ActiveRoomCount()
		queue := stats.QueueSize()
		fmt.Fprintf(w, `<span>%d online · %d active game%s · %d in queue</span>`,
			clients, rooms, plural(rooms), queue)
	}
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}
