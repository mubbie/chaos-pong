package ws

import "encoding/json"

// Envelope is the top-level JSON wrapper for all WebSocket messages.
// Two-phase deserialization: read Type first, then decode Payload based on type.
type Envelope struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// ParseEnvelope unmarshals raw bytes into an Envelope.
func ParseEnvelope(data []byte) (Envelope, error) {
	var env Envelope
	err := json.Unmarshal(data, &env)
	return env, err
}

// MarshalEnvelope creates JSON bytes from a type string and payload.
func MarshalEnvelope(msgType string, payload interface{}) ([]byte, error) {
	p, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	env := Envelope{
		Type:    msgType,
		Payload: p,
	}
	return json.Marshal(env)
}
