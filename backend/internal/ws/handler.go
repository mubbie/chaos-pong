package ws

import (
	"log"
	"net/http"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// OriginChecker is a function that determines if a WebSocket origin is allowed.
type OriginChecker func(origin string) bool

// HandleWebSocket upgrades the HTTP connection and creates a Client.
// The checkOrigin function controls which origins are accepted.
func HandleWebSocket(hub *Hub, router MessageRouter, checkOrigin OriginChecker) http.HandlerFunc {
	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				return true // Non-browser clients (curl, etc.)
			}
			allowed := checkOrigin(origin)
			if !allowed {
				log.Printf("[ws] rejected origin: %s", origin)
			}
			return allowed
		},
	}

	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("[ws] upgrade error: %v", err)
			return
		}

		client := &Client{
			ID:   uuid.New().String(),
			Conn: conn,
			Hub:  hub,
			Send: make(chan []byte, sendBufSize),
		}

		hub.register <- client

		// Send client their assigned ID immediately
		client.SendMessage("welcome", map[string]string{"id": client.ID})

		go client.WritePump()
		go client.ReadPump(router)
	}
}
