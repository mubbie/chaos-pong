package matchmaking

import (
	"fmt"
	"sync"
	"time"
)

// QueueEntry represents a player waiting for a match.
type QueueEntry struct {
	ClientID string
	Name     string
	JoinedAt time.Time
}

// MatchResult is returned when two players are matched.
type MatchResult struct {
	Player1 QueueEntry
	Player2 QueueEntry
}

// Queue is an in-memory FIFO matchmaking queue.
type Queue struct {
	mu      sync.Mutex
	entries []QueueEntry
}

// NewQueue creates an empty matchmaking queue.
func NewQueue() *Queue {
	return &Queue{
		entries: make([]QueueEntry, 0),
	}
}

// Enqueue adds a player to the queue. Returns error if already in queue.
func (q *Queue) Enqueue(entry QueueEntry) error {
	q.mu.Lock()
	defer q.mu.Unlock()

	for _, e := range q.entries {
		if e.ClientID == entry.ClientID {
			return fmt.Errorf("player %s already in queue", entry.ClientID)
		}
	}

	q.entries = append(q.entries, entry)
	return nil
}

// Dequeue removes a player from the queue by client ID.
func (q *Queue) Dequeue(clientID string) {
	q.mu.Lock()
	defer q.mu.Unlock()

	for i, e := range q.entries {
		if e.ClientID == clientID {
			q.entries = append(q.entries[:i], q.entries[i+1:]...)
			return
		}
	}
}

// TryMatch checks if two or more players are waiting and pops them.
func (q *Queue) TryMatch() (*MatchResult, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()

	if len(q.entries) < 2 {
		return nil, false
	}

	result := &MatchResult{
		Player1: q.entries[0],
		Player2: q.entries[1],
	}
	q.entries = q.entries[2:]

	return result, true
}

// Size returns the current number of players in the queue.
func (q *Queue) Size() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.entries)
}

// Contains checks if a given clientID is already in the queue.
func (q *Queue) Contains(clientID string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()

	for _, e := range q.entries {
		if e.ClientID == clientID {
			return true
		}
	}
	return false
}
