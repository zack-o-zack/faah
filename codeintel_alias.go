package main

import "faah/internal/codeintel"

// These types live in internal/codeintel so other packages can use them.
type (
	NavHit      = codeintel.NavHit
	HoverInfo   = codeintel.HoverInfo
	CallNode    = codeintel.CallNode
	Match       = codeintel.Match
	FileMatches = codeintel.FileMatches
)
