package session

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/mubbie/chaos-pong/backend/internal/game"
	"github.com/mubbie/chaos-pong/backend/internal/matchmaking"
	"github.com/mubbie/chaos-pong/backend/internal/ws"
)

// Manager tracks all active game rooms and coordinates lifecycle.
type Manager struct {
	rooms map[string]*game.GameRoom
	mu    sync.RWMutex
	hub   *ws.Hub
	queue *matchmaking.Queue
}

// NewManager creates a Manager wired to the Hub and Queue.
func NewManager(hub *ws.Hub, queue *matchmaking.Queue) *Manager {
	return &Manager{
		rooms: make(map[string]*game.GameRoom),
		hub:   hub,
		queue: queue,
	}
}

// --- Message payloads ---

type joinQueuePayload struct {
	Name string `json:"name"`
}

type playerInputPayload struct {
	Direction int `json:"direction"`
}

type queueStatusPayload struct {
	Status         string `json:"status"`
	Position       int    `json:"position"`
	PlayersInQueue int    `json:"playersInQueue"`
}

type gameStartPayload struct {
	RoomID    string         `json:"roomId"`
	You       playerInfo     `json:"you"`
	Opponent  playerInfo     `json:"opponent"`
	Arena     arenaInfo      `json:"arena"`
	Countdown int            `json:"countdown"`
}

type playerInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Side string `json:"side"`
}

type arenaInfo struct {
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type scoreUpdatePayload struct {
	ScorerID     string `json:"scorerId"`
	ScorerName   string `json:"scorerName"`
	Player1Score int    `json:"player1Score"`
	Player2Score int    `json:"player2Score"`
}

type gameEndPayload struct {
	WinnerID   string     `json:"winnerId"`
	WinnerName string     `json:"winnerName"`
	FinalScore finalScore `json:"finalScore"`
	RoomID     string     `json:"roomId"`
}

type finalScore struct {
	Player1 int `json:"player1"`
	Player2 int `json:"player2"`
}

type errorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type pingPayload struct {
	ClientTime int64 `json:"clientTime"`
}

type pongPayload struct {
	ClientTime int64 `json:"clientTime"`
	ServerTime int64 `json:"serverTime"`
}

// RouteMessage implements ws.MessageRouter.
func (m *Manager) RouteMessage(client *ws.Client, envelope ws.Envelope) {
	switch envelope.Type {
	case "join_queue":
		m.handleJoinQueue(client, envelope.Payload)
	case "leave_queue":
		m.handleLeaveQueue(client)
	case "player_input":
		m.handlePlayerInput(client, envelope.Payload)
	case "ping":
		m.handlePing(client, envelope.Payload)
	default:
		log.Printf("[manager] unknown message type from %s: %s", client.ID, envelope.Type)
		client.SendMessage("error", errorPayload{
			Code:    "UNKNOWN_TYPE",
			Message: "Unknown message type: " + envelope.Type,
		})
	}
}

func (m *Manager) handleJoinQueue(client *ws.Client, payload json.RawMessage) {
	// Reject if already in a game
	if client.GetRoomID() != "" {
		client.SendMessage("error", errorPayload{
			Code:    "ALREADY_IN_GAME",
			Message: "You are already in a game.",
		})
		return
	}

	var p joinQueuePayload
	if err := json.Unmarshal(payload, &p); err != nil || p.Name == "" {
		client.SendMessage("error", errorPayload{
			Code:    "INVALID_PAYLOAD",
			Message: "Name is required to join the queue.",
		})
		return
	}

	client.Name = p.Name

	err := m.queue.Enqueue(matchmaking.QueueEntry{
		ClientID: client.ID,
		Name:     p.Name,
		JoinedAt: time.Now(),
	})
	if err != nil {
		client.SendMessage("error", errorPayload{
			Code:    "ALREADY_IN_QUEUE",
			Message: "You are already in the queue.",
		})
		return
	}

	log.Printf("[manager] %s (%s) joined queue. Queue size: %d", p.Name, client.ID, m.queue.Size())

	client.SendMessage("queue_status", queueStatusPayload{
		Status:         "waiting",
		Position:       m.queue.Size(),
		PlayersInQueue: m.queue.Size(),
	})

	// Try to match
	match, found := m.queue.TryMatch()
	if !found {
		return
	}

	m.createRoom(match)
}

func (m *Manager) handleLeaveQueue(client *ws.Client) {
	m.queue.Dequeue(client.ID)
	log.Printf("[manager] %s left queue", client.ID)
	client.SendMessage("queue_status", queueStatusPayload{
		Status: "left",
	})
}

func (m *Manager) handlePlayerInput(client *ws.Client, payload json.RawMessage) {
	roomID := client.GetRoomID()
	if roomID == "" {
		return // Silently ignore input when not in a game
	}

	var p playerInputPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return
	}

	// Clamp direction to -1, 0, 1
	dir := game.PaddleDirection(p.Direction)
	if dir < -1 {
		dir = -1
	}
	if dir > 1 {
		dir = 1
	}

	m.mu.RLock()
	room, ok := m.rooms[roomID]
	m.mu.RUnlock()
	if !ok {
		return
	}

	room.SetInput(client.ID, dir)
}

func (m *Manager) handlePing(client *ws.Client, payload json.RawMessage) {
	var p pingPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return
	}
	client.SendMessage("pong", pongPayload{
		ClientTime: p.ClientTime,
		ServerTime: time.Now().UnixMilli(),
	})
}

func (m *Manager) createRoom(match *matchmaking.MatchResult) {
	roomID := uuid.New().String()

	c1 := m.hub.GetClient(match.Player1.ClientID)
	c2 := m.hub.GetClient(match.Player2.ClientID)
	if c1 == nil || c2 == nil {
		log.Printf("[manager] matched player disconnected before room creation")
		return
	}

	log.Printf("[manager] creating room %s: %s vs %s", roomID, match.Player1.Name, match.Player2.Name)

	// Broadcast callback — sends game state to both players
	broadcast := func(state game.GameState) {
		data, err := ws.MarshalEnvelope("game_state", state)
		if err != nil {
			return
		}
		select {
		case c1.Send <- data:
		default:
		}
		select {
		case c2.Send <- data:
		default:
		}
	}

	// Score callback
	onScore := func(scorerID, scorerName string, p1Score, p2Score int) {
		payload := scoreUpdatePayload{
			ScorerID:     scorerID,
			ScorerName:   scorerName,
			Player1Score: p1Score,
			Player2Score: p2Score,
		}
		c1.SendMessage("score_update", payload)
		c2.SendMessage("score_update", payload)
	}

	// Game end callback
	onEnd := func(roomID, winnerID, winnerName string, p1Score, p2Score int) {
		payload := gameEndPayload{
			WinnerID:   winnerID,
			WinnerName: winnerName,
			FinalScore: finalScore{Player1: p1Score, Player2: p2Score},
			RoomID:     roomID,
		}
		c1.SendMessage("game_end", payload)
		c2.SendMessage("game_end", payload)

		// Clean up
		c1.SetRoomID("")
		c2.SetRoomID("")
		m.RemoveRoom(roomID)
	}

	room := game.NewGameRoom(
		roomID,
		game.PlayerInfo{ID: match.Player1.ClientID, Name: match.Player1.Name},
		game.PlayerInfo{ID: match.Player2.ClientID, Name: match.Player2.Name},
		broadcast,
		onScore,
		onEnd,
	)

	m.mu.Lock()
	m.rooms[roomID] = room
	m.mu.Unlock()

	c1.SetRoomID(roomID)
	c2.SetRoomID(roomID)

	// Send game_start to both players
	c1.SendMessage("game_start", gameStartPayload{
		RoomID: roomID,
		You:    playerInfo{ID: c1.ID, Name: c1.Name, Side: "left"},
		Opponent: playerInfo{ID: c2.ID, Name: c2.Name, Side: "right"},
		Arena:  arenaInfo{Width: game.ArenaWidth, Height: game.ArenaHeight},
		Countdown: 3,
	})
	c2.SendMessage("game_start", gameStartPayload{
		RoomID: roomID,
		You:    playerInfo{ID: c2.ID, Name: c2.Name, Side: "right"},
		Opponent: playerInfo{ID: c1.ID, Name: c1.Name, Side: "left"},
		Arena:  arenaInfo{Width: game.ArenaWidth, Height: game.ArenaHeight},
		Countdown: 3,
	})

	// Start the game loop
	go room.Run()
}

// RemoveRoom cleans up a finished room.
func (m *Manager) RemoveRoom(roomID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.rooms, roomID)
	log.Printf("[manager] room %s removed", roomID)
}

// HandleDisconnect handles a player disconnecting.
func (m *Manager) HandleDisconnect(clientID string) {
	// Remove from queue if present
	m.queue.Dequeue(clientID)

	// Check if in a game room
	m.mu.RLock()
	var foundRoom *game.GameRoom
	var foundRoomID string
	for id, room := range m.rooms {
		if room.HasPlayer(clientID) {
			foundRoom = room
			foundRoomID = id
			break
		}
	}
	m.mu.RUnlock()

	if foundRoom == nil {
		return
	}

	log.Printf("[manager] player %s disconnected from room %s", clientID, foundRoomID)

	// Stop the game and declare the other player the winner
	foundRoom.Stop()

	winnerID, winnerName, p1Score, p2Score := foundRoom.GetForfeitResult(clientID)

	// Notify the remaining player
	winner := m.hub.GetClient(winnerID)
	if winner != nil {
		winner.SendMessage("game_end", gameEndPayload{
			WinnerID:   winnerID,
			WinnerName: winnerName,
			FinalScore: finalScore{Player1: p1Score, Player2: p2Score},
			RoomID:     foundRoomID,
		})
		winner.SetRoomID("")
	}

	m.RemoveRoom(foundRoomID)
}

// GetRoom returns a room by ID, or nil.
func (m *Manager) GetRoom(roomID string) *game.GameRoom {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.rooms[roomID]
}

// ActiveRoomCount returns the number of in-progress games.
func (m *Manager) ActiveRoomCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.rooms)
}

// ClientCount returns the number of connected WebSocket clients.
func (m *Manager) ClientCount() int {
	return m.hub.ClientCount()
}

// QueueSize returns the number of players waiting in the matchmaking queue.
func (m *Manager) QueueSize() int {
	return m.queue.Size()
}
