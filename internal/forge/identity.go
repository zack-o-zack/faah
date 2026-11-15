package forge

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

// ItemID is the stable workbench and persisted-session identity of a PR.
func ItemID(pt PRTarget) string {
	key := strings.ToLower(fmt.Sprintf("%s/%s/%s#%d", pt.Provider, pt.Owner, pt.Repo, pt.Number))
	h := sha256.Sum256([]byte("pr" + "\x00" + key))
	return hex.EncodeToString(h[:6])
}
