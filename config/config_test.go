package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeDockerSQLiteDSNUsesMountedDataDir(t *testing.T) {
	root := t.TempDir()
	appDataDir := filepath.Join(root, "data")
	if err := os.MkdirAll(appDataDir, 0755); err != nil {
		t.Fatal(err)
	}
	Cfg = Config{StorageDriver: "sqlite", DatabaseDSN: "data/lumaforge.db?_pragma=busy_timeout(5000)"}

	normalizeDockerSQLiteDSN(appDataDir)

	want := filepath.Join(root, "data", "lumaforge.db") + "?_pragma=busy_timeout(5000)"
	if Cfg.DatabaseDSN != want {
		t.Fatalf("DatabaseDSN = %q, want %q", Cfg.DatabaseDSN, want)
	}
}

func TestNormalizeDockerSQLiteDSNLeavesLocalPathWithoutMountedDataDir(t *testing.T) {
	Cfg = Config{StorageDriver: "sqlite", DatabaseDSN: "data/lumaforge.db"}

	normalizeDockerSQLiteDSN(filepath.Join(t.TempDir(), "missing-data"))

	if Cfg.DatabaseDSN != "data/lumaforge.db" {
		t.Fatalf("DatabaseDSN = %q, want relative local path", Cfg.DatabaseDSN)
	}
}

func TestAdoptLegacySQLiteDatabaseRenamesDefaultDatabase(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "infinite-canvas.db")
	current := filepath.Join(root, "lumaforge.db")
	if err := os.WriteFile(legacy, []byte("legacy-data"), 0600); err != nil {
		t.Fatal(err)
	}
	Cfg = Config{StorageDriver: "sqlite", DatabaseDSN: current}
	t.Setenv("DATABASE_DSN", "")
	if err := os.Unsetenv("DATABASE_DSN"); err != nil {
		t.Fatal(err)
	}

	adoptLegacySQLiteDatabase()

	if Cfg.DatabaseDSN != current {
		t.Fatalf("DatabaseDSN = %q, want %q", Cfg.DatabaseDSN, current)
	}
	if data, err := os.ReadFile(current); err != nil || string(data) != "legacy-data" {
		t.Fatalf("renamed database = %q, err %v", string(data), err)
	}
}

func TestAdoptLegacySQLiteDatabaseReplacesEmptyNewDatabase(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "infinite-canvas.db")
	current := filepath.Join(root, "lumaforge.db")
	if err := os.WriteFile(legacy, []byte("legacy-data"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(current, nil, 0600); err != nil {
		t.Fatal(err)
	}
	Cfg = Config{StorageDriver: "sqlite", DatabaseDSN: current}
	if err := os.Unsetenv("DATABASE_DSN"); err != nil {
		t.Fatal(err)
	}

	adoptLegacySQLiteDatabase()

	if data, err := os.ReadFile(current); err != nil || string(data) != "legacy-data" {
		t.Fatalf("adopted database = %q, err %v", string(data), err)
	}
	if _, err := os.Stat(current + ".empty"); err != nil {
		t.Fatalf("empty new database was not preserved: %v", err)
	}
}

func TestPersistentOrRandomSecretReusesLumaDataDirSecret(t *testing.T) {
	Cfg = Config{LumaForgeDataDir: t.TempDir()}

	first, err := persistentOrRandomSecret()
	if err != nil {
		t.Fatal(err)
	}
	second, err := persistentOrRandomSecret()
	if err != nil {
		t.Fatal(err)
	}
	if first == "" || second == "" || first != second {
		t.Fatalf("persistent secret mismatch: first=%q second=%q", first, second)
	}
	if _, err := os.Stat(filepath.Join(Cfg.LumaForgeDataDir, "auth_secret.key")); err != nil {
		t.Fatalf("auth secret was not written: %v", err)
	}
}
