package ws

import (
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 1024
	sendBufSize    = 256
)

// MessageRouter routes decoded messages from a client.
type MessageRouter interface {
	RouteMessage(client *Client, envelope Envelope)
	HandleDisconnect(clientID string)
}

// Client represents a single WebSocket connection.
type Client struct {
	ID     string
	Name   string
	Conn   *websocket.Conn
	Hub    *Hub
	Send   chan []byte
	RoomID string
	router MessageRouter
	mu     sync.Mutex
}

// SendMessage marshals and enqueues a message for the write pump.
func (c *Client) SendMessage(msgType string, payload interface{}) error {
	data, err := MarshalEnvelope(msgType, payload)
	if err != nil {
		return err
	}
	select {
	case c.Send <- data:
	default:
		log.Printf("[client] send buffer full for %s, dropping message", c.ID)
	}
	return nil
}

// SetRoomID safely sets the room ID for this client.
func (c *Client) SetRoomID(roomID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.RoomID = roomID
}

// GetRoomID safely gets the room ID for this client.
func (c *Client) GetRoomID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.RoomID
}

// ReadPump reads messages from the WebSocket and routes them.
// Runs in its own goroutine. Blocks until connection closes.
func (c *Client) ReadPump(router MessageRouter) {
	c.router = router
	defer func() {
		router.HandleDisconnect(c.ID)
		c.Hub.unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("[client] read error for %s: %v", c.ID, err)
			}
			return
		}

		env, err := ParseEnvelope(message)
		if err != nil {
			log.Printf("[client] invalid message from %s: %v", c.ID, err)
			continue
		}

		router.RouteMessage(c, env)
	}
}

// WritePump writes messages from the Send channel to the WebSocket.
// Runs in its own goroutine. Blocks until Send is closed.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
