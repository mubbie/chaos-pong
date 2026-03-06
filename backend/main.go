package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mubbie/chaos-pong/backend/internal/config"
	"github.com/mubbie/chaos-pong/backend/internal/matchmaking"
	"github.com/mubbie/chaos-pong/backend/internal/server"
	"github.com/mubbie/chaos-pong/backend/internal/session"
	"github.com/mubbie/chaos-pong/backend/internal/ws"
)

func main() {
	cfg := config.Load()

	hub := ws.NewHub()
	go hub.Run()

	queue := matchmaking.NewQueue()
	manager := session.NewManager(hub, queue)

	srv := server.New(hub, manager, manager, cfg)

	// Graceful shutdown on SIGINT / SIGTERM
	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("Chaos Pong server starting on %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-done
	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Shutdown error: %v", err)
	}
	log.Println("Server stopped")
}
