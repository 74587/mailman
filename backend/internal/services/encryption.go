package services

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"
)

const (
	// encryptionPrefix is prepended to encrypted values to identify them.
	encryptionPrefix = "enc::"
)

// Encryption provides AES-256-GCM encryption and decryption.
type Encryption struct {
	key []byte
}

var (
	encryptionInstance *Encryption
	encryptionOnce    sync.Once
	encryptionErr     error
)

// GetEncryption returns the singleton Encryption instance.
// The encryption key is read from the ENCRYPTION_KEY environment variable,
// which must be a base64-encoded 32-byte key.
func GetEncryption() (*Encryption, error) {
	encryptionOnce.Do(func() {
		keyStr := os.Getenv("ENCRYPTION_KEY")
		if keyStr == "" {
			// No encryption key configured — encryption is disabled.
			encryptionInstance = nil
			return
		}

		key, err := base64.StdEncoding.DecodeString(keyStr)
		if err != nil {
			encryptionErr = fmt.Errorf("invalid ENCRYPTION_KEY: failed to decode base64: %w", err)
			return
		}
		if len(key) != 32 {
			encryptionErr = fmt.Errorf("invalid ENCRYPTION_KEY: expected 32 bytes, got %d", len(key))
			return
		}

		encryptionInstance = &Encryption{key: key}
	})

	if encryptionErr != nil {
		return nil, encryptionErr
	}
	return encryptionInstance, nil
}

// Encrypt encrypts plaintext using AES-256-GCM and returns a prefixed base64 string.
// If the value is already encrypted (has the prefix), it is returned as-is.
// If no encryption key is configured, the plaintext is returned unchanged.
func (e *Encryption) Encrypt(plaintext string) (string, error) {
	if plaintext == "" {
		return plaintext, nil
	}
	// Already encrypted
	if len(plaintext) > len(encryptionPrefix) && plaintext[:len(encryptionPrefix)] == encryptionPrefix {
		return plaintext, nil
	}

	block, err := aes.NewCipher(e.key)
	if err != nil {
		return "", fmt.Errorf("failed to create cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to create GCM: %w", err)
	}

	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("failed to generate nonce: %w", err)
	}

	ciphertext := aesGCM.Seal(nonce, nonce, []byte(plaintext), nil)
	return encryptionPrefix + base64.StdEncoding.EncodeToString(ciphertext), nil
}

// Decrypt decrypts a value previously encrypted with Encrypt.
// If the value does not have the encryption prefix, it is returned as-is (plaintext passthrough).
// If no encryption key is configured, the value is returned unchanged.
func (e *Encryption) Decrypt(ciphertext string) (string, error) {
	if ciphertext == "" {
		return ciphertext, nil
	}
	// Not encrypted
	if len(ciphertext) <= len(encryptionPrefix) || ciphertext[:len(encryptionPrefix)] != encryptionPrefix {
		return ciphertext, nil
	}

	data, err := base64.StdEncoding.DecodeString(ciphertext[len(encryptionPrefix):])
	if err != nil {
		return "", fmt.Errorf("failed to decode ciphertext: %w", err)
	}

	block, err := aes.NewCipher(e.key)
	if err != nil {
		return "", fmt.Errorf("failed to create cipher: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to create GCM: %w", err)
	}

	nonceSize := aesGCM.NonceSize()
	if len(data) < nonceSize {
		return "", errors.New("ciphertext too short")
	}

	nonce, encrypted := data[:nonceSize], data[nonceSize:]
	plaintext, err := aesGCM.Open(nil, nonce, encrypted, nil)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt: %w", err)
	}

	return string(plaintext), nil
}

// EncryptIfAvailable encrypts the value if an encryption key is configured.
// Otherwise returns the value unchanged. This is a convenience function.
func EncryptIfAvailable(value string) string {
	enc, err := GetEncryption()
	if err != nil || enc == nil {
		return value
	}
	encrypted, err := enc.Encrypt(value)
	if err != nil {
		return value
	}
	return encrypted
}

// DecryptIfAvailable decrypts the value if an encryption key is configured.
// Otherwise returns the value unchanged. This is a convenience function.
func DecryptIfAvailable(value string) string {
	enc, err := GetEncryption()
	if err != nil || enc == nil {
		return value
	}
	decrypted, err := enc.Decrypt(value)
	if err != nil {
		return value
	}
	return decrypted
}

// DecryptAccountCredentials decrypts the Password and Token fields of an EmailAccount in-place.
// This should be called before using the account for IMAP/SMTP connections.
func DecryptAccountCredentials(password *string, token *string) {
	if password != nil && *password != "" {
		*password = DecryptIfAvailable(*password)
	}
	if token != nil && *token != "" {
		*token = DecryptIfAvailable(*token)
	}
}
