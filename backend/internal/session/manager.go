package session

import (
	"encoding/json"
	"log"
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/mubbie/chaos-pong/backend/internal/game"
	"github.com/mubbie/chaos-pong/backend/internal/matchmaking"
	"github.com/mubbie/chaos-pong/backend/internal/tournament"
	"github.com/mubbie/chaos-pong/backend/internal/ws"
)

// Manager tracks all active game rooms and coordinates lifecycle.
type Manager struct {
	rooms map[string]*game.GameRoom
	mu    sync.RWMutex
	hub   *ws.Hub
	queue *matchmaking.Queue

	tauntCooldowns map[string]time.Time
	tauntMu        sync.Mutex

	rematches map[string]*rematchState
	rematchMu sync.Mutex

	spectators                 map[string][]*ws.Client // roomID → spectator clients
	specMu                     sync.RWMutex
	spectatorReactionCooldowns map[string]time.Time

	tournamentMgr *tournament.Manager

	privateLobbies map[string]*PrivateLobby // code → lobby
	privateMu      sync.Mutex
}

// NewManager creates a Manager wired to the Hub and Queue.
func NewManager(hub *ws.Hub, queue *matchmaking.Queue) *Manager {
	return &Manager{
		rooms:                      make(map[string]*game.GameRoom),
		hub:                        hub,
		queue:                      queue,
		tauntCooldowns:             make(map[string]time.Time),
		rematches:                  make(map[string]*rematchState),
		spectators:                 make(map[string][]*ws.Client),
		spectatorReactionCooldowns: make(map[string]time.Time),
		tournamentMgr:              tournament.NewManager(),
		privateLobbies:             make(map[string]*PrivateLobby),
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
	RoomID      string     `json:"roomId"`
	You         playerInfo `json:"you"`
	Opponent    playerInfo `json:"opponent"`
	Arena       arenaInfo  `json:"arena"`
	Countdown   int        `json:"countdown"`
	IsSpectator bool       `json:"isSpectator,omitempty"`
	ScoreToWin  int        `json:"scoreToWin,omitempty"`
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
	WinnerID    string           `json:"winnerId"`
	WinnerName  string           `json:"winnerName"`
	FinalScore  finalScore       `json:"finalScore"`
	RoomID      string           `json:"roomId"`
	Stats       *game.MatchStats `json:"stats,omitempty"`
	IsSpectator bool             `json:"isSpectator,omitempty"`
	IsForfeit   bool             `json:"isForfeit,omitempty"`
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

type tauntPayload struct {
	TauntID int `json:"tauntId"`
}

type tauntBroadcastPayload struct {
	PlayerID string `json:"playerId"`
	TauntID  int    `json:"tauntId"`
}

type rematchState struct {
	RoomID    string
	Player1ID string
	Player2ID string
	P1Name    string
	P2Name    string
	Requests  map[string]bool
	Timer     *time.Timer
}

type rematchRequestPayload struct {
	RoomID string `json:"roomId"`
}

type rematchStatusPayload struct {
	Status string `json:"status"`
	RoomID string `json:"roomId"`
}

type matchInfo struct {
	RoomID         string `json:"roomId"`
	Player1Name    string `json:"player1Name"`
	Player2Name    string `json:"player2Name"`
	P1Score        int    `json:"p1Score"`
	P2Score        int    `json:"p2Score"`
	SpectatorCount int    `json:"spectatorCount"`
}

type matchListPayload struct {
	Matches []matchInfo `json:"matches"`
}

type spectateMatchPayload struct {
	RoomID string `json:"roomId"`
}

type spectatorReactionPayload struct {
	ReactionID int `json:"reactionId"`
}

type spectatorReactionBroadcast struct {
	SpectatorName string `json:"spectatorName"`
	ReactionID    int    `json:"reactionId"`
}

// --- Tournament payloads ---

type createTournamentPayload struct {
	Name string `json:"name"`
}

type joinTournamentPayload struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

type tournamentCreatedPayload struct {
	Code string `json:"code"`
}

type participantInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type bracketMatchInfo struct {
	Player1  *participantInfo `json:"player1,omitempty"`
	Player2  *participantInfo `json:"player2,omitempty"`
	WinnerID string           `json:"winnerId,omitempty"`
	P1Score  int              `json:"p1Score,omitempty"`
	P2Score  int              `json:"p2Score,omitempty"`
}

type tournamentStatePayload struct {
	Code                string            `json:"code"`
	State               int               `json:"state"`
	Participants        []participantInfo `json:"participants"`
	HostID              string            `json:"hostId"`
	SemiFinal1          *bracketMatchInfo `json:"semiFinal1,omitempty"`
	SemiFinal2          *bracketMatchInfo `json:"semiFinal2,omitempty"`
	Final               *bracketMatchInfo `json:"finalMatch,omitempty"`
	ChampionID          string            `json:"championId,omitempty"`
	ChampionName        string            `json:"championName,omitempty"`
	WaitingForContinue  bool              `json:"waitingForContinue,omitempty"`
}

// --- Private Lobby payloads ---

type createPrivatePayload struct {
	Name       string `json:"name"`
	ScoreToWin int    `json:"scoreToWin"`
}

type joinPrivatePayload struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

type privateLobbyCreatedPayload struct {
	Code       string `json:"code"`
	ScoreToWin int    `json:"scoreToWin"`
}

// PrivateLobby represents a waiting room for a 2-player private match.
type PrivateLobby struct {
	Code       string
	HostID     string
	HostName   string
	ScoreToWin int
	CreatedAt  time.Time
	Timer      *time.Timer
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
	case "taunt":
		m.handleTaunt(client, envelope.Payload)
	case "rematch_request":
		m.handleRematchRequest(client, envelope.Payload)
	case "list_matches":
		m.handleListMatches(client)
	case "spectate_match":
		m.handleSpectateMatch(client, envelope.Payload)
	case "leave_spectate":
		m.handleLeaveSpectate(client)
	case "spectator_reaction":
		m.handleSpectatorReaction(client, envelope.Payload)
	case "create_tournament":
		m.handleCreateTournament(client, envelope.Payload)
	case "join_tournament":
		m.handleJoinTournament(client, envelope.Payload)
	case "start_tournament":
		m.handleStartTournament(client, envelope.Payload)
	case "continue_tournament":
		m.handleContinueTournament(client)
	case "leave_match":
		m.handleLeaveMatch(client)
	case "pause_game":
		m.handlePauseGame(client)
	case "leave_tournament":
		m.handleLeaveTournament(client)
	case "create_private":
		m.handleCreatePrivate(client, envelope.Payload)
	case "join_private":
		m.handleJoinPrivate(client, envelope.Payload)
	case "leave_private":
		m.handleLeavePrivate(client)
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

func (m *Manager) handleTaunt(client *ws.Client, payload json.RawMessage) {
	roomID := client.GetRoomID()
	if roomID == "" {
		return // Not in a game
	}

	var p tauntPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return
	}

	// Validate taunt ID (1-6)
	if p.TauntID < 1 || p.TauntID > 6 {
		return
	}

	// Rate limit: 2 second cooldown per player
	m.tauntMu.Lock()
	lastTaunt, exists := m.tauntCooldowns[client.ID]
	now := time.Now()
	if exists && now.Sub(lastTaunt) < 2*time.Second {
		m.tauntMu.Unlock()
		return
	}
	m.tauntCooldowns[client.ID] = now
	m.tauntMu.Unlock()

	// Look up the room to get both player IDs
	m.mu.RLock()
	room, ok := m.rooms[roomID]
	m.mu.RUnlock()
	if !ok {
		return
	}

	p1ID, p2ID := room.GetPlayerIDs()
	broadcast := tauntBroadcastPayload{
		PlayerID: client.ID,
		TauntID:  p.TauntID,
	}

	if c := m.hub.GetClient(p1ID); c != nil {
		c.SendMessage("taunt", broadcast)
	}
	if c := m.hub.GetClient(p2ID); c != nil {
		c.SendMessage("taunt", broadcast)
	}

	// Also send to spectators
	m.specMu.RLock()
	for _, spec := range m.spectators[roomID] {
		spec.SendMessage("taunt", broadcast)
	}
	m.specMu.RUnlock()
}

func (m *Manager) handleRematchRequest(client *ws.Client, payload json.RawMessage) {
	var p rematchRequestPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return
	}

	m.rematchMu.Lock()
	rs, ok := m.rematches[p.RoomID]
	if !ok {
		m.rematchMu.Unlock()
		client.SendMessage("rematch_status", rematchStatusPayload{Status: "timeout", RoomID: p.RoomID})
		return
	}

	// Validate player is a participant
	if client.ID != rs.Player1ID && client.ID != rs.Player2ID {
		m.rematchMu.Unlock()
		return
	}

	// Mark this player's request
	rs.Requests[client.ID] = true

	// Check if both players have requested
	if len(rs.Requests) < 2 {
		m.rematchMu.Unlock()
		client.SendMessage("rematch_status", rematchStatusPayload{Status: "waiting", RoomID: p.RoomID})
		return
	}

	// Both players agreed — cancel timer and clean up
	rs.Timer.Stop()
	delete(m.rematches, p.RoomID)
	m.rematchMu.Unlock()

	// Notify both
	if c := m.hub.GetClient(rs.Player1ID); c != nil {
		c.SendMessage("rematch_status", rematchStatusPayload{Status: "accepted", RoomID: p.RoomID})
	}
	if c := m.hub.GetClient(rs.Player2ID); c != nil {
		c.SendMessage("rematch_status", rematchStatusPayload{Status: "accepted", RoomID: p.RoomID})
	}

	// Create new room with the same players
	m.createRoom(&matchmaking.MatchResult{
		Player1: matchmaking.QueueEntry{ClientID: rs.Player1ID, Name: rs.P1Name, JoinedAt: time.Now()},
		Player2: matchmaking.QueueEntry{ClientID: rs.Player2ID, Name: rs.P2Name, JoinedAt: time.Now()},
	})
}

func (m *Manager) handleListMatches(client *ws.Client) {
	m.mu.RLock()
	matches := make([]matchInfo, 0, len(m.rooms))
	for id, room := range m.rooms {
		p1Name, p2Name, p1Score, p2Score := room.GetMatchInfo()
		m.specMu.RLock()
		specCount := len(m.spectators[id])
		m.specMu.RUnlock()
		matches = append(matches, matchInfo{
			RoomID:         id,
			Player1Name:    p1Name,
			Player2Name:    p2Name,
			P1Score:        p1Score,
			P2Score:        p2Score,
			SpectatorCount: specCount,
		})
	}
	m.mu.RUnlock()
	client.SendMessage("match_list", matchListPayload{Matches: matches})
}

func (m *Manager) handleSpectateMatch(client *ws.Client, payload json.RawMessage) {
	var p spectateMatchPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return
	}

	// Validate not already in a game or spectating
	if client.GetRoomID() != "" {
		client.SendMessage("error", errorPayload{
			Code:    "ALREADY_IN_GAME",
			Message: "Leave your current game first.",
		})
		return
	}

	// Validate room exists
	m.mu.RLock()
	room, ok := m.rooms[p.RoomID]
	m.mu.RUnlock()
	if !ok {
		client.SendMessage("error", errorPayload{
			Code:    "ROOM_NOT_FOUND",
			Message: "That match has ended.",
		})
		return
	}

	// Remove from queue if present
	m.queue.Dequeue(client.ID)

	// Add to spectators list
	m.specMu.Lock()
	m.spectators[p.RoomID] = append(m.spectators[p.RoomID], client)
	m.specMu.Unlock()

	client.SetRoomID("spec:" + p.RoomID)

	// Send game_start with spectator info
	p1Name, p2Name, p1Score, p2Score := room.GetMatchInfo()
	client.SendMessage("game_start", gameStartPayload{
		RoomID:      p.RoomID,
		You:         playerInfo{ID: client.ID, Name: client.Name, Side: "left"},
		Opponent:    playerInfo{ID: "", Name: "", Side: "right"},
		Arena:       arenaInfo{Width: game.ArenaWidth, Height: game.ArenaHeight},
		Countdown:   0,
		IsSpectator: true,
		ScoreToWin:  room.GetScoreToWin(),
	})

	// Also send a spectator_info message with current match context
	client.SendMessage("spectator_info", struct {
		Player1Name string `json:"player1Name"`
		Player2Name string `json:"player2Name"`
		P1Score     int    `json:"p1Score"`
		P2Score     int    `json:"p2Score"`
	}{
		Player1Name: p1Name,
		Player2Name: p2Name,
		P1Score:     p1Score,
		P2Score:     p2Score,
	})

	log.Printf("[manager] %s now spectating room %s", client.ID, p.RoomID)
}

func (m *Manager) handleLeaveSpectate(client *ws.Client) {
	roomID := client.GetRoomID()
	if roomID == "" || !strings.HasPrefix(roomID, "spec:") {
		return
	}
	actualRoomID := strings.TrimPrefix(roomID, "spec:")

	m.specMu.Lock()
	m.removeSpectatorLocked(actualRoomID, client.ID)
	m.specMu.Unlock()

	client.SetRoomID("")
	log.Printf("[manager] %s left spectating room %s", client.ID, actualRoomID)
}

func (m *Manager) handleSpectatorReaction(client *ws.Client, payload json.RawMessage) {
	roomID := client.GetRoomID()
	if roomID == "" || !strings.HasPrefix(roomID, "spec:") {
		return
	}
	actualRoomID := strings.TrimPrefix(roomID, "spec:")

	var p spectatorReactionPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return
	}

	// Validate reaction ID (1-6)
	if p.ReactionID < 1 || p.ReactionID > 6 {
		return
	}

	// Rate limit: 1 second cooldown
	m.tauntMu.Lock()
	lastReaction, exists := m.spectatorReactionCooldowns[client.ID]
	now := time.Now()
	if exists && now.Sub(lastReaction) < 1*time.Second {
		m.tauntMu.Unlock()
		return
	}
	m.spectatorReactionCooldowns[client.ID] = now
	m.tauntMu.Unlock()

	// Broadcast to all players + spectators in the room
	broadcast := spectatorReactionBroadcast{
		SpectatorName: client.Name,
		ReactionID:    p.ReactionID,
	}

	// Send to players
	m.mu.RLock()
	room, ok := m.rooms[actualRoomID]
	m.mu.RUnlock()
	if ok {
		p1ID, p2ID := room.GetPlayerIDs()
		if c := m.hub.GetClient(p1ID); c != nil {
			c.SendMessage("spectator_reaction", broadcast)
		}
		if c := m.hub.GetClient(p2ID); c != nil {
			c.SendMessage("spectator_reaction", broadcast)
		}
	}

	// Send to all spectators
	m.specMu.RLock()
	for _, spec := range m.spectators[actualRoomID] {
		spec.SendMessage("spectator_reaction", broadcast)
	}
	m.specMu.RUnlock()
}

// removeSpectatorLocked removes a spectator from a room. Must hold specMu write lock.
func (m *Manager) removeSpectatorLocked(roomID, clientID string) {
	specs := m.spectators[roomID]
	for i, s := range specs {
		if s.ID == clientID {
			m.spectators[roomID] = append(specs[:i], specs[i+1:]...)
			break
		}
	}
	if len(m.spectators[roomID]) == 0 {
		delete(m.spectators, roomID)
	}
}

func (m *Manager) createRoom(match *matchmaking.MatchResult) {
	m.createRoomWithOptions(match, game.WinScore)
}

func (m *Manager) createRoomWithOptions(match *matchmaking.MatchResult, scoreToWin int) {
	roomID := uuid.New().String()

	c1 := m.hub.GetClient(match.Player1.ClientID)
	c2 := m.hub.GetClient(match.Player2.ClientID)
	if c1 == nil || c2 == nil {
		log.Printf("[manager] matched player disconnected before room creation")
		// Re-queue the surviving player so they aren't silently dropped
		if c1 != nil {
			m.queue.Enqueue(matchmaking.QueueEntry{
				ClientID: match.Player1.ClientID,
				Name:     match.Player1.Name,
				JoinedAt: time.Now(),
			})
			c1.SendMessage("queue_status", queueStatusPayload{
				Status:         "waiting",
				Position:       m.queue.Size(),
				PlayersInQueue: m.queue.Size(),
			})
		}
		if c2 != nil {
			m.queue.Enqueue(matchmaking.QueueEntry{
				ClientID: match.Player2.ClientID,
				Name:     match.Player2.Name,
				JoinedAt: time.Now(),
			})
			c2.SendMessage("queue_status", queueStatusPayload{
				Status:         "waiting",
				Position:       m.queue.Size(),
				PlayersInQueue: m.queue.Size(),
			})
		}
		return
	}

	log.Printf("[manager] creating room %s: %s vs %s (scoreToWin=%d)", roomID, match.Player1.Name, match.Player2.Name, scoreToWin)

	// Broadcast callback — sends game state to both players and spectators.
	// Uses SafeSendRaw to avoid panic on closed channel after disconnect.
	broadcast := func(state game.GameState) {
		data, err := ws.MarshalEnvelope("game_state", state)
		if err != nil {
			return
		}
		c1.SafeSendRaw(data)
		c2.SafeSendRaw(data)
		// Also send to spectators
		m.specMu.RLock()
		for _, spec := range m.spectators[roomID] {
			spec.SafeSendRaw(data)
		}
		m.specMu.RUnlock()
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
		// Also send to spectators
		m.specMu.RLock()
		for _, spec := range m.spectators[roomID] {
			spec.SendMessage("score_update", payload)
		}
		m.specMu.RUnlock()
	}

	// Game end callback
	onEnd := func(roomID, winnerID, winnerName string, p1Score, p2Score int, stats game.MatchStats) {
		payload := gameEndPayload{
			WinnerID:   winnerID,
			WinnerName: winnerName,
			FinalScore: finalScore{Player1: p1Score, Player2: p2Score},
			RoomID:     roomID,
			Stats:      &stats,
		}
		c1.SendMessage("game_end", payload)
		c2.SendMessage("game_end", payload)

		// Notify spectators
		m.specMu.Lock()
		for _, spec := range m.spectators[roomID] {
			spec.SendMessage("game_end", gameEndPayload{
				WinnerID:    winnerID,
				WinnerName:  winnerName,
				FinalScore:  finalScore{Player1: p1Score, Player2: p2Score},
				RoomID:      roomID,
				Stats:       &stats,
				IsSpectator: true,
			})
			spec.SetRoomID("")
		}
		delete(m.spectators, roomID)
		m.specMu.Unlock()

		// Clean up
		c1.SetRoomID("")
		c2.SetRoomID("")
		m.RemoveRoom(roomID)

		// Create rematch opportunity
		m.rematchMu.Lock()
		rs := &rematchState{
			RoomID:    roomID,
			Player1ID: c1.ID,
			Player2ID: c2.ID,
			P1Name:    c1.Name,
			P2Name:    c2.Name,
			Requests:  make(map[string]bool),
		}
		rs.Timer = time.AfterFunc(10*time.Second, func() {
			m.rematchMu.Lock()
			if _, ok := m.rematches[roomID]; ok {
				delete(m.rematches, roomID)
				m.rematchMu.Unlock()
				// Notify both players of timeout
				if tc := m.hub.GetClient(rs.Player1ID); tc != nil {
					tc.SendMessage("rematch_status", rematchStatusPayload{Status: "timeout", RoomID: roomID})
				}
				if tc := m.hub.GetClient(rs.Player2ID); tc != nil {
					tc.SendMessage("rematch_status", rematchStatusPayload{Status: "timeout", RoomID: roomID})
				}
			} else {
				m.rematchMu.Unlock()
			}
		})
		m.rematches[roomID] = rs
		m.rematchMu.Unlock()
	}

	room := game.NewGameRoom(
		roomID,
		game.PlayerInfo{ID: match.Player1.ClientID, Name: match.Player1.Name},
		game.PlayerInfo{ID: match.Player2.ClientID, Name: match.Player2.Name},
		broadcast,
		onScore,
		onEnd,
		game.WithScoreToWin(scoreToWin),
	)

	m.mu.Lock()
	m.rooms[roomID] = room
	m.mu.Unlock()

	c1.SetRoomID(roomID)
	c2.SetRoomID(roomID)

	// Send game_start to both players
	c1.SendMessage("game_start", gameStartPayload{
		RoomID:     roomID,
		You:        playerInfo{ID: c1.ID, Name: c1.Name, Side: "left"},
		Opponent:   playerInfo{ID: c2.ID, Name: c2.Name, Side: "right"},
		Arena:      arenaInfo{Width: game.ArenaWidth, Height: game.ArenaHeight},
		Countdown:  3,
		ScoreToWin: scoreToWin,
	})
	c2.SendMessage("game_start", gameStartPayload{
		RoomID:     roomID,
		You:        playerInfo{ID: c2.ID, Name: c2.Name, Side: "right"},
		Opponent:   playerInfo{ID: c1.ID, Name: c1.Name, Side: "left"},
		Arena:      arenaInfo{Width: game.ArenaWidth, Height: game.ArenaHeight},
		Countdown:  3,
		ScoreToWin: scoreToWin,
	})

	// Start the game loop
	go room.Run()
}

// --- Tournament handlers ---

func (m *Manager) handleCreateTournament(client *ws.Client, payload json.RawMessage) {
	// Validate not in game/queue/tournament
	if client.GetRoomID() != "" {
		client.SendMessage("error", errorPayload{Code: "ALREADY_IN_GAME", Message: "Leave your current game first."})
		return
	}
	if client.GetTournamentID() != "" {
		client.SendMessage("error", errorPayload{Code: "ALREADY_IN_TOURNAMENT", Message: "You are already in a tournament."})
		return
	}

	var p createTournamentPayload
	if err := json.Unmarshal(payload, &p); err == nil && p.Name != "" {
		client.Name = p.Name
	}
	if client.Name == "" {
		client.Name = "Player"
	}

	id := uuid.New().String()
	t := m.tournamentMgr.Create(id, client.ID)
	t.AddParticipant(client.ID, client.Name)
	client.SetTournamentID(t.Code)

	// Remove from queue
	m.queue.Dequeue(client.ID)

	client.SendMessage("tournament_created", tournamentCreatedPayload{Code: t.Code})
	client.SendMessage("tournament_state", m.buildTournamentState(t))

	log.Printf("[tournament] %s created tournament %s (code: %s)", client.Name, id, t.Code)
}

func (m *Manager) handleJoinTournament(client *ws.Client, payload json.RawMessage) {
	var p joinTournamentPayload
	if err := json.Unmarshal(payload, &p); err != nil || p.Code == "" {
		client.SendMessage("error", errorPayload{Code: "INVALID_PAYLOAD", Message: "Tournament code is required."})
		return
	}

	if client.GetRoomID() != "" {
		client.SendMessage("error", errorPayload{Code: "ALREADY_IN_GAME", Message: "Leave your current game first."})
		return
	}
	if client.GetTournamentID() != "" {
		client.SendMessage("error", errorPayload{Code: "ALREADY_IN_TOURNAMENT", Message: "You are already in a tournament."})
		return
	}

	// Set client name from payload if provided
	if p.Name != "" {
		client.Name = p.Name
	}
	if client.Name == "" {
		client.Name = "Player"
	}

	t := m.tournamentMgr.Get(strings.ToUpper(p.Code))
	if t == nil {
		client.SendMessage("error", errorPayload{Code: "TOURNAMENT_NOT_FOUND", Message: "No tournament with that code."})
		return
	}

	if t.GetState() != tournament.StateLobby {
		client.SendMessage("error", errorPayload{Code: "TOURNAMENT_STARTED", Message: "Tournament has already started."})
		return
	}

	if !t.AddParticipant(client.ID, client.Name) {
		client.SendMessage("error", errorPayload{Code: "TOURNAMENT_FULL", Message: "Tournament is full."})
		return
	}

	client.SetTournamentID(t.Code)

	// Remove from queue
	m.queue.Dequeue(client.ID)

	log.Printf("[tournament] %s joined tournament %s", client.Name, t.Code)

	// Broadcast updated state to all participants
	m.broadcastTournamentState(t)
}

func (m *Manager) handleStartTournament(client *ws.Client, _ json.RawMessage) {
	code := client.GetTournamentID()
	if code == "" {
		return
	}

	t := m.tournamentMgr.Get(code)
	if t == nil {
		return
	}

	if !t.IsHost(client.ID) {
		client.SendMessage("error", errorPayload{Code: "NOT_HOST", Message: "Only the host can start the tournament."})
		return
	}

	if !t.IsFull() {
		client.SendMessage("error", errorPayload{Code: "NOT_ENOUGH_PLAYERS", Message: "Need 4 players to start."})
		return
	}

	if !t.Start() {
		client.SendMessage("error", errorPayload{Code: "ALREADY_STARTED", Message: "Tournament has already started."})
		return
	}

	log.Printf("[tournament] %s started, waiting for host to continue", t.Code)

	// Wait for host to click Continue before starting first match
	t.SetWaitingForContinue(true)
	m.broadcastTournamentState(t)
}

func (m *Manager) handleContinueTournament(client *ws.Client) {
	code := client.GetTournamentID()
	if code == "" {
		return
	}

	t := m.tournamentMgr.Get(code)
	if t == nil {
		return
	}

	if !t.IsHost(client.ID) {
		client.SendMessage("error", errorPayload{Code: "NOT_HOST", Message: "Only the host can continue."})
		return
	}

	if !t.TryConsumeContinue() {
		return // Not waiting, or already consumed by another call
	}

	log.Printf("[tournament] %s host clicked continue, starting next match", t.Code)
	m.startTournamentMatch(t)
}

func (m *Manager) startTournamentMatch(t *tournament.Tournament) {
	p1, p2, ok := t.GetCurrentMatch()
	if !ok {
		return
	}

	c1 := m.hub.GetClient(p1.ClientID)
	c2 := m.hub.GetClient(p2.ClientID)
	if c1 == nil || c2 == nil {
		log.Printf("[tournament] player disconnected before match start in tournament %s", t.Code)
		// Forfeit: if one player missing, other wins
		if c1 != nil {
			t.RecordMatchResult(p1.ClientID, p1.Name, p2.ClientID, p2.Name, 1, 0)
		} else if c2 != nil {
			t.RecordMatchResult(p2.ClientID, p2.Name, p1.ClientID, p1.Name, 1, 0)
		} else {
			// Both gone, just advance
			t.RecordMatchResult(p1.ClientID, p1.Name, p2.ClientID, p2.Name, 0, 0)
		}
		if t.GetState() == tournament.StateComplete {
			m.broadcastTournamentState(t)
			m.clearTournamentIDs(t)
			_, champName := t.GetChampion()
			log.Printf("[tournament] %s complete (pre-match forfeit)! Champion: %s", t.Code, champName)
			time.AfterFunc(30*time.Second, func() {
				m.tournamentMgr.Remove(t.Code)
			})
		} else {
			// Wait for host to click Continue
			t.SetWaitingForContinue(true)
			m.broadcastTournamentState(t)
		}
		return
	}

	m.createTournamentRoom(t, p1, p2, c1, c2)
}

func (m *Manager) createTournamentRoom(t *tournament.Tournament, p1, p2 tournament.Participant, c1, c2 *ws.Client) {
	roomID := uuid.New().String()
	t.SetActiveRoomID(roomID)

	log.Printf("[tournament] creating room %s for %s vs %s (tournament %s)", roomID, p1.Name, p2.Name, t.Code)

	broadcast := func(state game.GameState) {
		data, err := ws.MarshalEnvelope("game_state", state)
		if err != nil {
			return
		}
		c1.SafeSendRaw(data)
		c2.SafeSendRaw(data)
		// Also send to spectators (waiting tournament players)
		m.specMu.RLock()
		for _, spec := range m.spectators[roomID] {
			spec.SafeSendRaw(data)
		}
		m.specMu.RUnlock()
	}

	onScore := func(scorerID, scorerName string, p1Score, p2Score int) {
		payload := scoreUpdatePayload{
			ScorerID:     scorerID,
			ScorerName:   scorerName,
			Player1Score: p1Score,
			Player2Score: p2Score,
		}
		c1.SendMessage("score_update", payload)
		c2.SendMessage("score_update", payload)
		m.specMu.RLock()
		for _, spec := range m.spectators[roomID] {
			spec.SendMessage("score_update", payload)
		}
		m.specMu.RUnlock()
	}

	onEnd := func(endRoomID, winnerID, winnerName string, p1Score, p2Score int, stats game.MatchStats) {
		// Determine loser
		var loserID, loserName string
		if winnerID == p1.ClientID {
			loserID, loserName = p2.ClientID, p2.Name
		} else {
			loserID, loserName = p1.ClientID, p1.Name
		}

		// Record result in tournament bracket
		t.RecordMatchResult(winnerID, winnerName, loserID, loserName, p1Score, p2Score)

		// Send game_end to players
		endPayload := gameEndPayload{
			WinnerID:   winnerID,
			WinnerName: winnerName,
			FinalScore: finalScore{Player1: p1Score, Player2: p2Score},
			RoomID:     endRoomID,
			Stats:      &stats,
		}
		c1.SendMessage("game_end", endPayload)
		c2.SendMessage("game_end", endPayload)

		// Send game_end to spectators
		m.specMu.Lock()
		for _, spec := range m.spectators[endRoomID] {
			spec.SendMessage("game_end", gameEndPayload{
				WinnerID:    winnerID,
				WinnerName:  winnerName,
				FinalScore:  finalScore{Player1: p1Score, Player2: p2Score},
				RoomID:      endRoomID,
				Stats:       &stats,
				IsSpectator: true,
			})
			spec.SetRoomID("")
		}
		delete(m.spectators, endRoomID)
		m.specMu.Unlock()

		// Clean up room
		c1.SetRoomID("")
		c2.SetRoomID("")
		t.SetActiveRoomID("")
		m.RemoveRoom(endRoomID)

		// Check if tournament is complete
		if t.GetState() == tournament.StateComplete {
			// Broadcast final state then clean up
			m.broadcastTournamentState(t)
			m.clearTournamentIDs(t)
			_, champName := t.GetChampion()
			log.Printf("[tournament] %s complete! Champion: %s", t.Code, champName)
			time.AfterFunc(30*time.Second, func() {
				m.tournamentMgr.Remove(t.Code)
				log.Printf("[tournament] %s cleaned up", t.Code)
			})
			return
		}

		// Wait for host to click Continue before starting next match
		t.SetWaitingForContinue(true)
		m.broadcastTournamentState(t)
	}

	room := game.NewGameRoom(
		roomID,
		game.PlayerInfo{ID: p1.ClientID, Name: p1.Name},
		game.PlayerInfo{ID: p2.ClientID, Name: p2.Name},
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
		RoomID:    roomID,
		You:       playerInfo{ID: c1.ID, Name: c1.Name, Side: "left"},
		Opponent:  playerInfo{ID: c2.ID, Name: c2.Name, Side: "right"},
		Arena:     arenaInfo{Width: game.ArenaWidth, Height: game.ArenaHeight},
		Countdown: 3,
	})
	c2.SendMessage("game_start", gameStartPayload{
		RoomID:    roomID,
		You:       playerInfo{ID: c2.ID, Name: c2.Name, Side: "right"},
		Opponent:  playerInfo{ID: c1.ID, Name: c1.Name, Side: "left"},
		Arena:     arenaInfo{Width: game.ArenaWidth, Height: game.ArenaHeight},
		Countdown: 3,
	})

	// Auto-spectate waiting players
	waitingIDs := t.GetWaitingPlayers()
	for _, wid := range waitingIDs {
		wc := m.hub.GetClient(wid)
		if wc == nil {
			continue
		}
		// Add as spectator
		m.specMu.Lock()
		m.spectators[roomID] = append(m.spectators[roomID], wc)
		m.specMu.Unlock()
		wc.SetRoomID("spec:" + roomID)

		p1Name, p2Name, p1Score, p2Score := room.GetMatchInfo()
		wc.SendMessage("game_start", gameStartPayload{
			RoomID:      roomID,
			You:         playerInfo{ID: wc.ID, Name: wc.Name, Side: "left"},
			Opponent:    playerInfo{ID: "", Name: "", Side: "right"},
			Arena:       arenaInfo{Width: game.ArenaWidth, Height: game.ArenaHeight},
			Countdown:   0,
			IsSpectator: true,
		})
		wc.SendMessage("spectator_info", struct {
			Player1Name string `json:"player1Name"`
			Player2Name string `json:"player2Name"`
			P1Score     int    `json:"p1Score"`
			P2Score     int    `json:"p2Score"`
		}{
			Player1Name: p1Name,
			Player2Name: p2Name,
			P1Score:     p1Score,
			P2Score:     p2Score,
		})
	}

	go room.Run()
}

func (m *Manager) buildTournamentState(t *tournament.Tournament) tournamentStatePayload {
	participants := make([]participantInfo, 0)
	for _, p := range t.Participants {
		participants = append(participants, participantInfo{ID: p.ClientID, Name: p.Name})
	}

	payload := tournamentStatePayload{
		Code:               t.Code,
		State:              int(t.GetState()),
		Participants:       participants,
		HostID:             t.GetHostID(),
		WaitingForContinue: t.IsWaitingForContinue(),
	}

	// Build bracket info
	state := t.GetState()
	if state >= tournament.StateSemiFinal1 {
		payload.SemiFinal1 = &bracketMatchInfo{
			Player1: &participantInfo{ID: t.Bracket.SemiFinal1[0].ClientID, Name: t.Bracket.SemiFinal1[0].Name},
			Player2: &participantInfo{ID: t.Bracket.SemiFinal1[1].ClientID, Name: t.Bracket.SemiFinal1[1].Name},
		}
		if t.Bracket.SF1Result != nil {
			payload.SemiFinal1.WinnerID = t.Bracket.SF1Result.WinnerID
			payload.SemiFinal1.P1Score = t.Bracket.SF1Result.P1Score
			payload.SemiFinal1.P2Score = t.Bracket.SF1Result.P2Score
		}

		payload.SemiFinal2 = &bracketMatchInfo{
			Player1: &participantInfo{ID: t.Bracket.SemiFinal2[0].ClientID, Name: t.Bracket.SemiFinal2[0].Name},
			Player2: &participantInfo{ID: t.Bracket.SemiFinal2[1].ClientID, Name: t.Bracket.SemiFinal2[1].Name},
		}
		if t.Bracket.SF2Result != nil {
			payload.SemiFinal2.WinnerID = t.Bracket.SF2Result.WinnerID
			payload.SemiFinal2.P1Score = t.Bracket.SF2Result.P1Score
			payload.SemiFinal2.P2Score = t.Bracket.SF2Result.P2Score
		}
	}

	if state >= tournament.StateFinal && t.Bracket.FinalPair[0].ClientID != "" {
		payload.Final = &bracketMatchInfo{
			Player1: &participantInfo{ID: t.Bracket.FinalPair[0].ClientID, Name: t.Bracket.FinalPair[0].Name},
			Player2: &participantInfo{ID: t.Bracket.FinalPair[1].ClientID, Name: t.Bracket.FinalPair[1].Name},
		}
		if t.Bracket.FinalResult != nil {
			payload.Final.WinnerID = t.Bracket.FinalResult.WinnerID
			payload.Final.P1Score = t.Bracket.FinalResult.P1Score
			payload.Final.P2Score = t.Bracket.FinalResult.P2Score
		}
	}

	if state == tournament.StateComplete {
		champID, champName := t.GetChampion()
		payload.ChampionID = champID
		payload.ChampionName = champName
	}

	return payload
}

func (m *Manager) broadcastTournamentState(t *tournament.Tournament) {
	state := m.buildTournamentState(t)
	for _, p := range t.Participants {
		if c := m.hub.GetClient(p.ClientID); c != nil {
			c.SendMessage("tournament_state", state)
		}
	}
}

// handleLeaveTournament allows a player to voluntarily leave a tournament lobby.
func (m *Manager) handleLeaveTournament(client *ws.Client) {
	code := client.GetTournamentID()
	if code == "" {
		return
	}

	t := m.tournamentMgr.Get(code)
	if t == nil {
		client.SetTournamentID("")
		return
	}

	// Only allow leaving from lobby state
	if t.GetState() != tournament.StateLobby {
		client.SendMessage("error", errorPayload{
			Code:    "TOURNAMENT_IN_PROGRESS",
			Message: "Cannot leave a tournament in progress.",
		})
		return
	}

	wasHost := t.IsHost(client.ID)
	t.RemoveParticipant(client.ID)
	client.SetTournamentID("")

	if t.ParticipantCount() == 0 {
		m.tournamentMgr.Remove(code)
		log.Printf("[tournament] %s removed (empty after leave)", code)
	} else {
		if wasHost {
			t.ReassignHost(client.ID)
			log.Printf("[tournament] %s host reassigned after leave", code)
		}
		m.broadcastTournamentState(t)
	}

	log.Printf("[manager] %s left tournament %s", client.ID, code)
}

// handleTournamentMatchEnd handles tournament advancement after a match ends
// via forfeit (disconnect or leave_match), since Stop() bypasses the onEnd callback.
func (m *Manager) handleTournamentMatchEnd(tournCode, winnerID, winnerName, loserID, loserName string, p1Score, p2Score int) {
	t := m.tournamentMgr.Get(tournCode)
	if t == nil {
		return
	}

	// Only process if tournament is in a match state
	state := t.GetState()
	if state == tournament.StateLobby || state == tournament.StateComplete {
		return
	}

	t.RecordMatchResult(winnerID, winnerName, loserID, loserName, p1Score, p2Score)
	t.SetActiveRoomID("")

	if t.GetState() == tournament.StateComplete {
		m.broadcastTournamentState(t)
		m.clearTournamentIDs(t)
		_, champName := t.GetChampion()
		log.Printf("[tournament] %s complete (forfeit)! Champion: %s", t.Code, champName)
		time.AfterFunc(30*time.Second, func() {
			m.tournamentMgr.Remove(t.Code)
			log.Printf("[tournament] %s cleaned up", t.Code)
		})
	} else {
		// Wait for host to click Continue (same as normal match end)
		t.SetWaitingForContinue(true)
		m.broadcastTournamentState(t)
	}
}

// clearTournamentIDs clears the TournamentID for all connected participants in a tournament.
func (m *Manager) clearTournamentIDs(t *tournament.Tournament) {
	for _, p := range t.Participants {
		if c := m.hub.GetClient(p.ClientID); c != nil {
			c.SetTournamentID("")
		}
	}
}

// RemoveRoom cleans up a finished room.
func (m *Manager) RemoveRoom(roomID string) {
	m.mu.Lock()
	delete(m.rooms, roomID)
	m.mu.Unlock()
	// Clean up spectators
	m.specMu.Lock()
	delete(m.spectators, roomID)
	m.specMu.Unlock()
	log.Printf("[manager] room %s removed", roomID)
}

// HandleDisconnect handles a player disconnecting.
func (m *Manager) HandleDisconnect(clientID string) {
	// Remove from queue if present
	m.queue.Dequeue(clientID)

	// Clean up taunt cooldown and spectator reaction cooldown
	m.tauntMu.Lock()
	delete(m.tauntCooldowns, clientID)
	delete(m.spectatorReactionCooldowns, clientID)
	m.tauntMu.Unlock()

	// Clean up any private lobby
	m.privateMu.Lock()
	for code, lobby := range m.privateLobbies {
		if lobby.HostID == clientID {
			lobby.Timer.Stop()
			delete(m.privateLobbies, code)
			log.Printf("[private] lobby %s removed (host %s disconnected)", code, clientID)
			break
		}
	}
	m.privateMu.Unlock()

	// Clean up any pending rematch
	m.rematchMu.Lock()
	for roomID, rs := range m.rematches {
		if rs.Player1ID == clientID || rs.Player2ID == clientID {
			rs.Timer.Stop()
			delete(m.rematches, roomID)
			// Notify the other player
			otherID := rs.Player1ID
			if otherID == clientID {
				otherID = rs.Player2ID
			}
			if c := m.hub.GetClient(otherID); c != nil {
				c.SendMessage("rematch_status", rematchStatusPayload{Status: "declined", RoomID: roomID})
			}
			break
		}
	}
	m.rematchMu.Unlock()

	// Check if spectating
	specRoomID := ""
	m.specMu.Lock()
	for roomID, specs := range m.spectators {
		for _, s := range specs {
			if s.ID == clientID {
				specRoomID = roomID
				break
			}
		}
		if specRoomID != "" {
			break
		}
	}
	if specRoomID != "" {
		m.removeSpectatorLocked(specRoomID, clientID)
	}
	m.specMu.Unlock()

	// Check if in a tournament
	tournCode := m.tournamentMgr.FindByPlayer(clientID)
	isTournament := false
	if tournCode != "" {
		t := m.tournamentMgr.Get(tournCode)
		if t != nil {
			currentState := t.GetState()
			if currentState == tournament.StateLobby {
				// In lobby — remove participant and handle host reassignment
				wasHost := t.IsHost(clientID)
				t.RemoveParticipant(clientID)
				if t.ParticipantCount() == 0 {
					m.tournamentMgr.Remove(tournCode)
					log.Printf("[tournament] %s removed (empty)", tournCode)
				} else {
					if wasHost {
						t.ReassignHost(clientID)
						log.Printf("[tournament] %s host reassigned after disconnect", tournCode)
					}
					m.broadcastTournamentState(t)
				}
			} else if currentState != tournament.StateComplete {
				// Tournament is in progress — flag for bracket advancement after forfeit
				isTournament = true

				// If tournament is between matches (waitingForContinue) and host disconnects,
				// reassign host and re-broadcast so a new host can click Continue
				if t.IsWaitingForContinue() {
					wasHost := t.IsHost(clientID)
					if wasHost && t.ParticipantCount() > 1 {
						t.ReassignHost(clientID)
						log.Printf("[tournament] %s host reassigned during waiting (disconnect)", tournCode)
					}
					m.broadcastTournamentState(t)
				}
			}
		}
	}

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

	log.Printf("[manager] player %s disconnected from room %s (tournament=%v)", clientID, foundRoomID, isTournament)

	// Stop the game and declare the other player the winner
	foundRoom.Stop()

	winnerID, winnerName, p1Score, p2Score, stats := foundRoom.GetForfeitResult(clientID)

	// Get disconnected player's name for tournament result recording
	var loserName string
	if c := m.hub.GetClient(clientID); c != nil {
		loserName = c.Name
	}

	// Notify the remaining player
	winner := m.hub.GetClient(winnerID)
	if winner != nil {
		winner.SendMessage("game_end", gameEndPayload{
			WinnerID:   winnerID,
			WinnerName: winnerName,
			FinalScore: finalScore{Player1: p1Score, Player2: p2Score},
			RoomID:     foundRoomID,
			Stats:      &stats,
			IsForfeit:  true,
		})
		winner.SetRoomID("")
	}

	// Notify spectators of game end
	m.specMu.Lock()
	for _, spec := range m.spectators[foundRoomID] {
		spec.SendMessage("game_end", gameEndPayload{
			WinnerID:    winnerID,
			WinnerName:  winnerName,
			FinalScore:  finalScore{Player1: p1Score, Player2: p2Score},
			RoomID:      foundRoomID,
			IsSpectator: true,
		})
		spec.SetRoomID("")
	}
	delete(m.spectators, foundRoomID)
	m.specMu.Unlock()

	if isTournament {
		// Tournament match: advance bracket (onEnd was bypassed by Stop())
		m.handleTournamentMatchEnd(tournCode, winnerID, winnerName, clientID, loserName, p1Score, p2Score)
	}

	m.RemoveRoom(foundRoomID)
}

// handleLeaveMatch allows a player to voluntarily forfeit and leave a match.
func (m *Manager) handleLeaveMatch(client *ws.Client) {
	clientID := client.ID

	// Find the room this player is in
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

	// Check if this is a tournament match
	tournCode := m.tournamentMgr.FindByPlayer(clientID)
	isTournament := false
	if tournCode != "" {
		if t := m.tournamentMgr.Get(tournCode); t != nil && t.GetState() != tournament.StateLobby {
			isTournament = true
		}
	}

	log.Printf("[manager] player %s voluntarily left room %s (tournament=%v)", clientID, foundRoomID, isTournament)

	// Stop the game and declare the other player the winner
	foundRoom.Stop()

	winnerID, winnerName, p1Score, p2Score, stats := foundRoom.GetForfeitResult(clientID)

	// Notify the remaining player
	winner := m.hub.GetClient(winnerID)
	if winner != nil {
		winner.SendMessage("game_end", gameEndPayload{
			WinnerID:   winnerID,
			WinnerName: winnerName,
			FinalScore: finalScore{Player1: p1Score, Player2: p2Score},
			RoomID:     foundRoomID,
			Stats:      &stats,
			IsForfeit:  true,
		})
		winner.SetRoomID("")
	}

	// Notify spectators of game end
	m.specMu.Lock()
	for _, spec := range m.spectators[foundRoomID] {
		spec.SendMessage("game_end", gameEndPayload{
			WinnerID:    winnerID,
			WinnerName:  winnerName,
			FinalScore:  finalScore{Player1: p1Score, Player2: p2Score},
			RoomID:      foundRoomID,
			IsSpectator: true,
		})
		spec.SetRoomID("")
	}
	delete(m.spectators, foundRoomID)
	m.specMu.Unlock()

	// Clear the leaving player's room
	client.SetRoomID("")

	if isTournament {
		// Tournament match: advance bracket (onEnd was bypassed by Stop())
		m.handleTournamentMatchEnd(tournCode, winnerID, winnerName, clientID, client.Name, p1Score, p2Score)
	} else {
		// Regular match: create rematch opportunity
		m.rematchMu.Lock()
		if rs, ok := m.rematches[foundRoomID]; ok {
			rs.Timer.Stop()
			delete(m.rematches, foundRoomID)
		}
		m.rematchMu.Unlock()
	}

	m.RemoveRoom(foundRoomID)
}

// handlePauseGame toggles the pause state for a game room.
// Either player can pause or unpause. Spectators cannot pause.
func (m *Manager) handlePauseGame(client *ws.Client) {
	clientID := client.ID

	// Find the room this player is in
	m.mu.RLock()
	var foundRoom *game.GameRoom
	for _, room := range m.rooms {
		if room.HasPlayer(clientID) {
			foundRoom = room
			break
		}
	}
	m.mu.RUnlock()

	if foundRoom == nil {
		return
	}

	foundRoom.TogglePause(clientID)
}

// --- Private lobby handlers ---

const privateLobbyCodeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func (m *Manager) generatePrivateLobbyCode() string {
	for {
		code := make([]byte, 4)
		for i := range code {
			code[i] = privateLobbyCodeChars[rand.Intn(len(privateLobbyCodeChars))]
		}
		s := string(code)
		if _, exists := m.privateLobbies[s]; !exists {
			return s
		}
	}
}

func (m *Manager) handleCreatePrivate(client *ws.Client, payload json.RawMessage) {
	// Validate not already in a game or private lobby
	if client.GetRoomID() != "" {
		client.SendMessage("error", errorPayload{Code: "ALREADY_IN_GAME", Message: "Leave your current game first."})
		return
	}
	if client.GetTournamentID() != "" {
		client.SendMessage("error", errorPayload{Code: "ALREADY_IN_TOURNAMENT", Message: "Leave the tournament first."})
		return
	}

	var p createPrivatePayload
	if err := json.Unmarshal(payload, &p); err == nil && p.Name != "" {
		client.Name = p.Name
	}
	if client.Name == "" {
		client.Name = "Player"
	}

	scoreToWin := p.ScoreToWin
	if scoreToWin != 5 && scoreToWin != 7 && scoreToWin != 11 {
		scoreToWin = game.WinScore // default
	}

	// Remove from queue if present
	m.queue.Dequeue(client.ID)

	m.privateMu.Lock()
	code := m.generatePrivateLobbyCode()
	lobby := &PrivateLobby{
		Code:       code,
		HostID:     client.ID,
		HostName:   client.Name,
		ScoreToWin: scoreToWin,
		CreatedAt:  time.Now(),
	}
	// Auto-expire after 2 minutes
	lobby.Timer = time.AfterFunc(2*time.Minute, func() {
		m.privateMu.Lock()
		if _, ok := m.privateLobbies[code]; ok {
			delete(m.privateLobbies, code)
			m.privateMu.Unlock()
			// Notify host if still connected
			if c := m.hub.GetClient(client.ID); c != nil {
				if c.GetRoomID() == "private:"+code {
					c.SetRoomID("")
				}
				c.SendMessage("error", errorPayload{
					Code:    "LOBBY_EXPIRED",
					Message: "Private lobby expired (2 minute timeout).",
				})
			}
			log.Printf("[private] lobby %s expired", code)
		} else {
			m.privateMu.Unlock()
		}
	})
	m.privateLobbies[code] = lobby
	m.privateMu.Unlock()

	client.SetRoomID("private:" + code)

	client.SendMessage("private_lobby_created", privateLobbyCreatedPayload{
		Code:       code,
		ScoreToWin: scoreToWin,
	})

	log.Printf("[private] %s created lobby %s (scoreToWin=%d)", client.Name, code, scoreToWin)
}

func (m *Manager) handleJoinPrivate(client *ws.Client, payload json.RawMessage) {
	var p joinPrivatePayload
	if err := json.Unmarshal(payload, &p); err != nil || p.Code == "" {
		client.SendMessage("error", errorPayload{Code: "INVALID_PAYLOAD", Message: "Lobby code is required."})
		return
	}

	if client.GetRoomID() != "" {
		client.SendMessage("error", errorPayload{Code: "ALREADY_IN_GAME", Message: "Leave your current game first."})
		return
	}
	if client.GetTournamentID() != "" {
		client.SendMessage("error", errorPayload{Code: "ALREADY_IN_TOURNAMENT", Message: "Leave the tournament first."})
		return
	}

	if p.Name != "" {
		client.Name = p.Name
	}
	if client.Name == "" {
		client.Name = "Player"
	}

	code := strings.ToUpper(p.Code)

	m.privateMu.Lock()
	lobby, ok := m.privateLobbies[code]
	if !ok {
		m.privateMu.Unlock()
		client.SendMessage("error", errorPayload{Code: "LOBBY_NOT_FOUND", Message: "No lobby with that code."})
		return
	}

	// Don't let host join their own lobby
	if lobby.HostID == client.ID {
		m.privateMu.Unlock()
		client.SendMessage("error", errorPayload{Code: "SELF_JOIN", Message: "You can't join your own lobby."})
		return
	}

	// Grab lobby data and clean up
	hostID := lobby.HostID
	hostName := lobby.HostName
	scoreToWin := lobby.ScoreToWin
	lobby.Timer.Stop()
	delete(m.privateLobbies, code)
	m.privateMu.Unlock()

	// Clear both players' private roomIDs
	if c := m.hub.GetClient(hostID); c != nil {
		c.SetRoomID("")
	}
	client.SetRoomID("")

	// Remove joiner from queue
	m.queue.Dequeue(client.ID)

	log.Printf("[private] %s joined lobby %s (host: %s, scoreToWin=%d)", client.Name, code, hostName, scoreToWin)

	// Create room with custom scoreToWin
	m.createRoomWithOptions(&matchmaking.MatchResult{
		Player1: matchmaking.QueueEntry{ClientID: hostID, Name: hostName, JoinedAt: time.Now()},
		Player2: matchmaking.QueueEntry{ClientID: client.ID, Name: client.Name, JoinedAt: time.Now()},
	}, scoreToWin)
}

func (m *Manager) handleLeavePrivate(client *ws.Client) {
	roomID := client.GetRoomID()
	if !strings.HasPrefix(roomID, "private:") {
		return
	}
	code := strings.TrimPrefix(roomID, "private:")

	m.privateMu.Lock()
	if lobby, ok := m.privateLobbies[code]; ok {
		lobby.Timer.Stop()
		delete(m.privateLobbies, code)
	}
	m.privateMu.Unlock()

	client.SetRoomID("")
	log.Printf("[private] %s left/cancelled lobby %s", client.ID, code)
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
