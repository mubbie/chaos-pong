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

	// Rate limiting: allow a burst of messages, then throttle.
	// A 60 tick/s game client sends ~60 player_input/s + pings.
	// 120/s burst with 100/s sustained handles that comfortably.
	rateBurst    = 120 // max tokens in bucket
	ratePerSec   = 100 // tokens refilled per second
	rateInterval = 10 * time.Millisecond // refill check interval
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
	RoomID       string
	TournamentID string
	router       MessageRouter
	mu     sync.Mutex
	closed bool
}

// SendMessage marshals and enqueues a message for the write pump.
// Safe to call concurrently, even after the client has been closed.
func (c *Client) SendMessage(msgType string, payload interface{}) error {
	data, err := MarshalEnvelope(msgType, payload)
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil
	}
	select {
	case c.Send <- data:
	default:
		log.Printf("[client] send buffer full for %s, dropping message", c.ID)
	}
	return nil
}

// SafeSendRaw enqueues pre-marshalled data for the write pump.
// Safe to call concurrently, even after the client has been closed.
func (c *Client) SafeSendRaw(data []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	select {
	case c.Send <- data:
	default:
	}
}

// Close marks the client as closed and closes the Send channel.
// Safe to call multiple times.
func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed {
		c.closed = true
		close(c.Send)
	}
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

// SetTournamentID safely sets the tournament code for this client.
func (c *Client) SetTournamentID(code string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.TournamentID = code
}

// GetTournamentID safely gets the tournament code for this client.
func (c *Client) GetTournamentID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.TournamentID
}

// ReadPump reads messages from the WebSocket and routes them.
// Runs in its own goroutine. Blocks until connection closes.
// Includes a token-bucket rate limiter to prevent message flood abuse.
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

	// Token bucket rate limiter
	tokens := rateBurst
	lastRefill := time.Now()

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("[client] read error for %s: %v", c.ID, err)
			}
			return
		}

		// Refill tokens based on elapsed time
		now := time.Now()
		elapsed := now.Sub(lastRefill).Seconds()
		tokens += int(elapsed * float64(ratePerSec))
		if tokens > rateBurst {
			tokens = rateBurst
		}
		lastRefill = now

		// Check rate limit
		if tokens <= 0 {
			// Drop the message silently (client is flooding)
			continue
		}
		tokens--

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
