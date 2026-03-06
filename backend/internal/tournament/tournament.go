package tournament

import (
	"math/rand"
	"sync"
)

// TournamentState represents the current phase.
type TournamentState int

const (
	StateLobby      TournamentState = 0
	StateSemiFinal1 TournamentState = 1
	StateSemiFinal2 TournamentState = 2
	StateFinal      TournamentState = 3
	StateComplete   TournamentState = 4
)

// Participant is a player in the tournament.
type Participant struct {
	ClientID string
	Name     string
}

// MatchResult stores the outcome of a tournament match.
type MatchResult struct {
	WinnerID   string
	WinnerName string
	LoserID    string
	LoserName  string
	P1Score    int
	P2Score    int
}

// Bracket holds the tournament bracket structure.
type Bracket struct {
	SemiFinal1  [2]Participant
	SemiFinal2  [2]Participant
	SF1Result   *MatchResult
	SF2Result   *MatchResult
	FinalPair   [2]Participant
	FinalResult *MatchResult
}

// Tournament represents a 4-player tournament.
type Tournament struct {
	ID                 string
	Code               string
	HostID             string
	State              TournamentState
	Participants       []Participant
	Bracket            Bracket
	ActiveRoomID       string
	waitingForContinue bool
	mu                 sync.Mutex
}

// NewTournament creates a new tournament.
func NewTournament(id, code, hostID string) *Tournament {
	return &Tournament{
		ID:           id,
		Code:         code,
		HostID:       hostID,
		State:        StateLobby,
		Participants: make([]Participant, 0, 4),
	}
}

// AddParticipant adds a player to the tournament. Returns false if full or duplicate.
func (t *Tournament) AddParticipant(clientID, name string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.Participants) >= 4 {
		return false
	}
	for _, p := range t.Participants {
		if p.ClientID == clientID {
			return false
		}
	}
	t.Participants = append(t.Participants, Participant{ClientID: clientID, Name: name})
	return true
}

// RemoveParticipant removes a player from the lobby. Returns false if not found.
func (t *Tournament) RemoveParticipant(clientID string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	for i, p := range t.Participants {
		if p.ClientID == clientID {
			t.Participants = append(t.Participants[:i], t.Participants[i+1:]...)
			return true
		}
	}
	return false
}

// IsFull returns true if the tournament has 4 participants.
func (t *Tournament) IsFull() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.Participants) >= 4
}

// ParticipantCount returns the number of participants.
func (t *Tournament) ParticipantCount() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.Participants)
}

// IsHost returns true if the given clientID is the host.
func (t *Tournament) IsHost(clientID string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.HostID == clientID
}

// GetHostID returns the current host's client ID.
func (t *Tournament) GetHostID() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.HostID
}

// ReassignHost promotes the first remaining participant to host
// if the current host matches oldHostID. Returns true if reassigned.
func (t *Tournament) ReassignHost(oldHostID string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.HostID != oldHostID || len(t.Participants) == 0 {
		return false
	}
	t.HostID = t.Participants[0].ClientID
	return true
}

// GetParticipantName returns the display name for a participant by ID.
func (t *Tournament) GetParticipantName(clientID string) string {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, p := range t.Participants {
		if p.ClientID == clientID {
			return p.Name
		}
	}
	return ""
}

// HasParticipant checks if a client is a participant.
func (t *Tournament) HasParticipant(clientID string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, p := range t.Participants {
		if p.ClientID == clientID {
			return true
		}
	}
	return false
}

// Start shuffles participants and generates the bracket. Must have 4 participants.
func (t *Tournament) Start() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.Participants) != 4 || t.State != StateLobby {
		return false
	}

	// Shuffle participants
	shuffled := make([]Participant, len(t.Participants))
	copy(shuffled, t.Participants)
	rand.Shuffle(len(shuffled), func(i, j int) {
		shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
	})

	t.Bracket.SemiFinal1 = [2]Participant{shuffled[0], shuffled[1]}
	t.Bracket.SemiFinal2 = [2]Participant{shuffled[2], shuffled[3]}
	t.State = StateSemiFinal1

	return true
}

// GetCurrentMatch returns the two participants for the current match.
func (t *Tournament) GetCurrentMatch() (p1, p2 Participant, ok bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	switch t.State {
	case StateSemiFinal1:
		return t.Bracket.SemiFinal1[0], t.Bracket.SemiFinal1[1], true
	case StateSemiFinal2:
		return t.Bracket.SemiFinal2[0], t.Bracket.SemiFinal2[1], true
	case StateFinal:
		return t.Bracket.FinalPair[0], t.Bracket.FinalPair[1], true
	default:
		return Participant{}, Participant{}, false
	}
}

// RecordMatchResult records the result for the current round and advances state.
func (t *Tournament) RecordMatchResult(winnerID, winnerName, loserID, loserName string, p1Score, p2Score int) {
	t.mu.Lock()
	defer t.mu.Unlock()

	result := &MatchResult{
		WinnerID:   winnerID,
		WinnerName: winnerName,
		LoserID:    loserID,
		LoserName:  loserName,
		P1Score:    p1Score,
		P2Score:    p2Score,
	}

	switch t.State {
	case StateSemiFinal1:
		t.Bracket.SF1Result = result
		t.State = StateSemiFinal2
	case StateSemiFinal2:
		t.Bracket.SF2Result = result
		// Set up final
		t.Bracket.FinalPair = [2]Participant{
			{ClientID: t.Bracket.SF1Result.WinnerID, Name: t.Bracket.SF1Result.WinnerName},
			{ClientID: result.WinnerID, Name: result.WinnerName},
		}
		t.State = StateFinal
	case StateFinal:
		t.Bracket.FinalResult = result
		t.State = StateComplete
	}
}

// GetWaitingPlayers returns participant IDs not playing in the current match.
func (t *Tournament) GetWaitingPlayers() []string {
	t.mu.Lock()
	defer t.mu.Unlock()

	var currentIDs []string
	switch t.State {
	case StateSemiFinal1:
		currentIDs = []string{t.Bracket.SemiFinal1[0].ClientID, t.Bracket.SemiFinal1[1].ClientID}
	case StateSemiFinal2:
		currentIDs = []string{t.Bracket.SemiFinal2[0].ClientID, t.Bracket.SemiFinal2[1].ClientID}
	case StateFinal:
		currentIDs = []string{t.Bracket.FinalPair[0].ClientID, t.Bracket.FinalPair[1].ClientID}
	default:
		return nil
	}

	currentSet := make(map[string]bool)
	for _, id := range currentIDs {
		currentSet[id] = true
	}

	var waiting []string
	for _, p := range t.Participants {
		if !currentSet[p.ClientID] {
			waiting = append(waiting, p.ClientID)
		}
	}
	return waiting
}

// GetChampion returns the tournament winner. Returns empty if not complete.
func (t *Tournament) GetChampion() (string, string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.State != StateComplete || t.Bracket.FinalResult == nil {
		return "", ""
	}
	return t.Bracket.FinalResult.WinnerID, t.Bracket.FinalResult.WinnerName
}

// GetState returns the current state.
func (t *Tournament) GetState() TournamentState {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.State
}

// SetActiveRoomID sets the current active game room ID.
func (t *Tournament) SetActiveRoomID(roomID string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.ActiveRoomID = roomID
}

// GetActiveRoomID returns the current active game room ID.
func (t *Tournament) GetActiveRoomID() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.ActiveRoomID
}

// SetWaitingForContinue sets whether the tournament is waiting for the host to continue.
func (t *Tournament) SetWaitingForContinue(v bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.waitingForContinue = v
}

// IsWaitingForContinue returns whether the tournament is waiting for the host to continue.
func (t *Tournament) IsWaitingForContinue() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.waitingForContinue
}

// TryConsumeContinue atomically checks and clears waitingForContinue.
// Returns true if it was waiting (and is now cleared), false otherwise.
func (t *Tournament) TryConsumeContinue() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.waitingForContinue {
		return false
	}
	t.waitingForContinue = false
	return true
}
