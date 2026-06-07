package repository

// KeysetCursor points at one row in a stable keyset-ordered list.
// Value is the primary sort column value serialized by the API layer.
type KeysetCursor struct {
	Value string
	ID    uint
}

// KeysetPagination selects rows after or before a cursor.
// At most one of After or Before should be set.
type KeysetPagination struct {
	Enabled bool
	After   *KeysetCursor
	Before  *KeysetCursor
}

func (p KeysetPagination) IsCursorMode() bool {
	return p.Enabled || p.After != nil || p.Before != nil
}
