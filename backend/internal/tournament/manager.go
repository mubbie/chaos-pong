package tournament

import (
	"math/rand"
	"sync"
)

const codeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no I/O/0/1 for clarity

// Manager manages all active tournaments.
type Manager struct {
	tournaments map[string]*Tournament // code -> tournament
	mu          sync.RWMutex
}

// NewManager creates a new tournament manager.
func NewManager() *Manager {
	return &Manager{
		tournaments: make(map[string]*Tournament),
	}
}

// Create makes a new tournament with a random 4-letter code.
func (m *Manager) Create(id, hostID string) *Tournament {
	m.mu.Lock()
	defer m.mu.Unlock()

	code := m.generateCode()
	t := NewTournament(id, code, hostID)
	m.tournaments[code] = t
	return t
}

// Get returns a tournament by code.
func (m *Manager) Get(code string) *Tournament {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.tournaments[code]
}

// Remove deletes a tournament by code.
func (m *Manager) Remove(code string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.tournaments, code)
}

// FindByPlayer finds the tournament code a player is in.
func (m *Manager) FindByPlayer(clientID string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for code, t := range m.tournaments {
		if t.HasParticipant(clientID) {
			return code
		}
	}
	return ""
}

// generateCode creates a unique 4-letter code.
func (m *Manager) generateCode() string {
	for {
		code := make([]byte, 4)
		for i := range code {
			code[i] = codeChars[rand.Intn(len(codeChars))]
		}
		s := string(code)
		if _, exists := m.tournaments[s]; !exists {
			return s
		}
	}
}
