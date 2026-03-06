package main

import (
	"log"

	"github.com/mubbie/chaos-pong/backend/internal/matchmaking"
	"github.com/mubbie/chaos-pong/backend/internal/server"
	"github.com/mubbie/chaos-pong/backend/internal/session"
	"github.com/mubbie/chaos-pong/backend/internal/ws"
)

func main() {
	hub := ws.NewHub()
	go hub.Run()

	queue := matchmaking.NewQueue()
	manager := session.NewManager(hub, queue)

	srv := server.New(hub, manager, manager)

	log.Printf("Chaos Pong server starting on %s", srv.Addr)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
