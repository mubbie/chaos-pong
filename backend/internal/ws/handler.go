package ws

import (
	"log"
	"net/http"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins in development
	},
}

// HandleWebSocket upgrades the HTTP connection and creates a Client.
func HandleWebSocket(hub *Hub, router MessageRouter) http.HandlerFunc {
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

		go client.WritePump()
		go client.ReadPump(router)
	}
}
