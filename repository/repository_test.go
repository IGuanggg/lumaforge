package repository

import (
	"path/filepath"
	"sync"
	"testing"

	"github.com/IGuanggg/lumaforge/config"
)

func useTempRepositoryDB(t *testing.T) {
	t.Helper()

	previousConfig := config.Cfg
	closeRepositoryDB()

	config.Cfg.StorageDriver = "sqlite"
	config.Cfg.DatabaseDSN = filepath.Join(t.TempDir(), "repository-test.db")
	dbOnce = sync.Once{}
	db = nil
	dbErr = nil

	t.Cleanup(func() {
		closeRepositoryDB()
		config.Cfg = previousConfig
		dbOnce = sync.Once{}
		db = nil
		dbErr = nil
	})
}

func closeRepositoryDB() {
	if db == nil {
		return
	}
	if sqlDB, err := db.DB(); err == nil {
		_ = sqlDB.Close()
	}
}
