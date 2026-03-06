package ws

import (
	"log"
	"sync"
)

// Hub maintains the set of active clients and handles registration.
type Hub struct {
	clients    map[string]*Client
	mu         sync.RWMutex
	register   chan *Client
	unregister chan *Client
}

// NewHub creates a new Hub.
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[string]*Client),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

// Run starts the hub's event loop. Must be called in its own goroutine.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client.ID] = client
			h.mu.Unlock()
			log.Printf("[hub] client registered: %s", client.ID)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.ID]; ok {
				delete(h.clients, client.ID)
				close(client.Send)
			}
			h.mu.Unlock()
			log.Printf("[hub] client unregistered: %s", client.ID)
		}
	}
}

// GetClient returns a client by ID, or nil if not found.
func (h *Hub) GetClient(id string) *Client {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.clients[id]
}

// ClientCount returns the number of connected clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
